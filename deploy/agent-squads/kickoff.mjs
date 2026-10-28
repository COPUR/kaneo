#!/usr/bin/env node
// Starts the iteration: every squad agent, signed in with its own API key,
// pulls one card (pick.mjs), moves it to In Progress, sets Agent status to
// Claimed and says so in a comment. A squad with a card in progress keeps it
// (one board per squad agent, WIP limit 1). Squad agents are plain members,
// which cannot assign, so the Agent status field marks the claim instead.
// Run after backlog.mjs; safe to re-run.
//
// From here the agents work through the Kaneo MCP server with the same keys,
// and only the CI/CD agent can move a card to Done.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { client, loadEnv } from "./lib.mjs";
import { pickNext } from "./pick.mjs";
import { squads, tribe } from "./squads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));
const agents = JSON.parse(
  readFileSync(join(here, ".generated", "agents.json"), "utf8"),
);

async function kickoff(squad) {
  const agent = agents[`${squad.id}-agent`];
  const call = client({ apiKey: agent.apiKey });
  const { data: workspaces } = await call("GET", "/workspace");
  const workspace = workspaces.find((w) => w.slug === tribe.slug);
  const { data: projects } = await call(
    "GET",
    `/project?workspaceId=${workspace.id}`,
  );
  const project = projects.find((p) => p.slug === squad.key);
  const { data: board } = await call(
    "GET",
    `/task/tasks/${project.id}?limit=100`,
  );
  const columns = board.data?.columns ?? [];
  const tasksIn = (slug) => columns.find((c) => c.slug === slug)?.tasks ?? [];

  const [current] = tasksIn("in-progress");
  if (current) return `${squad.key}  keeps    ${current.title}`;

  const backlog = tasksIn("to-do");
  const blockers = new Map();
  for (const task of backlog) {
    const { data } = await call("GET", `/task-relation/${task.id}`);
    blockers.set(task.id, data ?? []);
  }
  const next = pickNext(backlog, blockers);
  if (!next) return `${squad.key}  idle     nothing unblocked in Backlog`;

  await call("PUT", `/task/status/${next.id}`, { status: "in-progress" });
  const { data: fields } = await call(
    "GET",
    `/custom-field/project/${project.id}`,
  );
  const status = fields.find((f) => f.name === "Agent status");
  if (status) {
    await call("PUT", "/custom-field/value", {
      taskId: next.id,
      fieldId: status.id,
      value: "Claimed",
    });
  }
  await call("POST", `/comment/${next.id}`, {
    content: `${agent.name} claimed this card. Work happens on a branch; the CI/CD agent merges and closes it.`,
  });
  return `${squad.key}  claimed  ${next.title}`;
}

for (const squad of squads) {
  try {
    console.log(await kickoff(squad));
  } catch (error) {
    console.error(`${squad.key}  error    ${error.message}`);
    process.exitCode = 1;
  }
}
