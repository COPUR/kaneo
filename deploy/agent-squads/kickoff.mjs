#!/usr/bin/env node
// Starts the iteration: every squad agent, signed in with its own API key,
// pulls one card (pick.mjs), moves it to In Progress, sets Agent status to
// Claimed and says so in a comment. A squad with a card in progress keeps it
// (one board per squad agent, WIP limit 1). Squad agents are plain members,
// which cannot assign, so the Agent status field marks the claim instead.
// Run after backlog.mjs; safe to re-run.
//
// From here the agents work through the Kaneo MCP server with the same keys
// (run-squads.sh), and only the CI/CD agent can move a card to Done.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { currentOrClaim, openBoard } from "./board.mjs";
import { loadEnv } from "./lib.mjs";
import { squads } from "./squads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(join(here, ".env"));
const agents = JSON.parse(
  readFileSync(join(here, ".generated", "agents.json"), "utf8"),
);

async function kickoff(squad) {
  const agent = agents[`${squad.id}-agent`];
  const board = await openBoard(agent, squad.key);
  const { task, claimed } = await currentOrClaim(board, agent);
  if (!task) return `${squad.key}  idle     nothing unblocked in Backlog`;
  return `${squad.key}  ${claimed ? "claimed" : "keeps  "}  ${task.title}`;
}

for (const squad of squads) {
  try {
    console.log(await kickoff(squad));
  } catch (error) {
    console.error(`${squad.key}  error    ${error.message}`);
    process.exitCode = 1;
  }
}
