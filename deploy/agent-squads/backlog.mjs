#!/usr/bin/env node
// Loads the EV PnC backlog onto the squad boards, run after seed.mjs:
//
//   node backlog.mjs [kanban.csv ...]
//
// Each CSV uses the EV_PNC_docs kanban shape (Epic, Id, Title, Iteration,
// Repository, Owner, Points, Human gate, Depends on, Body). Cards land on the
// board of the squad that owns the repository (repos.mjs); product-owner gates
// land on the Decisions board. A walking-skeleton card is added for every
// existing repository. "Depends on" becomes a "blocks" relation when both
// cards are on the boards.
//
// Safe to re-run: a card whose "[Id]" title prefix exists is skipped.
// CURRENT_ITERATION (default I3) sets which cards are high priority.
// WALKING_SKELETONS=0 skips the per-repository walking-skeleton cards.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./csv.mjs";
import { client, loadEnv, required, signIn } from "./lib.mjs";
import { planCard, walkingSkeletons } from "./plan.mjs";
import { tribe } from "./squads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));

const currentIteration = process.env.CURRENT_ITERATION || "I3";
const iterationColor = "#94a3b8";
const cardId = (title) => /^\[([^\]]+)\]/.exec(title)?.[1];

async function boards(call, workspaceId) {
  const { data: projects } = await call(
    "GET",
    `/project?workspaceId=${workspaceId}`,
  );
  const byKey = new Map();
  const existing = new Map();
  for (const project of projects) {
    byKey.set(project.slug, project);
    const { data: body } = await call(
      "GET",
      `/task/tasks/${project.id}?limit=100`,
    );
    for (const column of body.data?.columns ?? []) {
      for (const task of column.tasks ?? []) {
        const id = cardId(task.title);
        if (id) existing.set(id, task.id);
      }
    }
  }
  return { byKey, existing };
}

async function labelIds(call, workspaceId, names) {
  const { data } = await call("GET", `/label/workspace/${workspaceId}`);
  // Attaching a label copies it onto the task; keep the workspace originals.
  const ids = new Map(
    (data ?? []).filter((l) => !l.taskId).map((l) => [l.name, l.id]),
  );
  for (const name of names) {
    if (ids.has(name)) continue;
    const { data: label } = await call("POST", "/label", {
      name,
      color: iterationColor,
      workspaceId,
    });
    ids.set(name, label.id);
  }
  return ids;
}

async function main() {
  const call = client();
  await signIn(call, {
    email: required("KANEO_OWNER_EMAIL"),
    password: required("KANEO_OWNER_PASSWORD"),
  });
  const { data: workspaces } = await call("GET", "/workspace");
  const workspace = workspaces.find((w) => w.slug === tribe.slug);
  if (!workspace) throw new Error("Run seed.mjs first");

  const rows = process.argv
    .slice(2)
    .flatMap((file) => parseCsv(readFileSync(file, "utf8")));
  const cards = [
    ...rows.map((row) => planCard(row, { currentIteration })),
    ...(process.env.WALKING_SKELETONS === "0"
      ? []
      : walkingSkeletons({ currentIteration })),
  ];

  const { byKey, existing } = await boards(call, workspace.id);
  const labels = await labelIds(
    call,
    workspace.id,
    new Set(cards.flatMap((c) => c.labels)),
  );

  let created = 0;
  for (const card of cards) {
    if (existing.has(card.id)) continue;
    const project = byKey.get(card.board);
    const { data: task } = await call("POST", `/task/${project.id}`, {
      title: card.title,
      description: card.description,
      priority: card.priority,
      status: card.status,
    });
    existing.set(card.id, task.id);
    for (const name of card.labels) {
      await call("PUT", `/label/${labels.get(name)}/task`, { taskId: task.id });
    }
    for (const dep of card.dependsOn) {
      if (!existing.has(dep)) continue;
      await call("POST", "/task-relation", {
        sourceTaskId: existing.get(dep),
        targetTaskId: task.id,
        relationType: "blocks",
      });
    }
    created++;
    console.log(
      `  ${card.board.padEnd(4)} ${card.priority.padEnd(6)} ${card.title}`,
    );
  }
  console.log(
    `\n${created} new cards, ${cards.length - created} already on the boards.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
