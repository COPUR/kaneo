#!/usr/bin/env node
// Smoke test for the single-closer rule, run after seed.mjs:
// a squad agent can create and move work but cannot close it; the CI/CD agent
// can close squad work but cannot touch the Decisions board.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { squads, tribe } from "./squads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const agents = JSON.parse(
  readFileSync(join(here, ".generated", "agents.json"), "utf8"),
);
const apiUrl = (
  process.env.KANEO_API_URL ||
  `${process.env.KANEO_CLIENT_URL || "http://localhost:5173"}/api`
).replace(/\/$/, "");

async function as(agentId, method, path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": agents[agentId].apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

let failed = 0;
function expect(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label} (got ${actual})`);
}

async function projectByKey(agentId, key) {
  const { data: workspaces } = await as(agentId, "GET", "/workspace");
  const workspace = workspaces.find((w) => w.slug === tribe.slug);
  const { data: projects } = await as(
    agentId,
    "GET",
    `/project?workspaceId=${workspace.id}`,
  );
  return projects.find((p) => p.slug === key);
}

const squad = squads[1];
const squadAgent = `${squad.id}-agent`;
const project = await projectByKey(squadAgent, squad.key);

const { status: created, data: task } = await as(
  squadAgent,
  "POST",
  `/task/${project.id}`,
  {
    title: "Smoke test: single closer",
    description: "Created by verify.mjs",
    priority: "low",
    status: "to-do",
  },
);
expect(`${squadAgent} creates a task in Backlog (to-do)`, created, 200);

expect(
  `${squadAgent} moves it to In Review`,
  (
    await as(squadAgent, "PUT", `/task/status/${task.id}`, {
      status: "in-review",
    })
  ).status,
  200,
);
expect(
  `${squadAgent} cannot move it to Done`,
  (await as(squadAgent, "PUT", `/task/status/${task.id}`, { status: "done" }))
    .status,
  403,
);
expect(
  `${squadAgent} cannot create a task straight in Done`,
  (
    await as(squadAgent, "POST", `/task/${project.id}`, {
      title: "Should be rejected",
      description: "",
      priority: "low",
      status: "done",
    })
  ).status,
  403,
);
expect(
  `${squadAgent} cannot bulk-close`,
  (
    await as(squadAgent, "PATCH", "/task/bulk", {
      taskIds: [task.id],
      operation: "updateStatus",
      value: "done",
    })
  ).status,
  403,
);
expect(
  "cicd-agent moves it to Done",
  (await as("cicd-agent", "PUT", `/task/status/${task.id}`, { status: "done" }))
    .status,
  200,
);

const decisions = await projectByKey(squadAgent, tribe.decisions.key);
expect(
  "cicd-agent has no access to the Decisions board",
  (await as("cicd-agent", "GET", `/task/tasks/${decisions.id}`)).status,
  403,
);

await as("cicd-agent", "DELETE", `/task/${task.id}`);
process.exit(failed ? 1 : 0);
