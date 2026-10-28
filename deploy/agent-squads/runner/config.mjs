// Runner settings, from deploy/agent-squads/.env or the environment.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib.mjs";

export const deployDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(join(deployDir, ".env"));

const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const expand = (path) => path.replace(/^~(?=\/|$)/, homedir());

export const config = {
  // Next to this checkout, like setup.sh's EV_PNC_docs: ~/Downloads on the Mac.
  reposDir: expand(
    process.env.SQUAD_REPOS_DIR || resolve(deployDir, "../../.."),
  ),
  githubOwner: process.env.SQUAD_GITHUB_OWNER || "COPUR",
  runDir: join(deployDir, ".runner"),
  // Cards a squad agent finishes (PR or decision) before it stops.
  maxCards: num("SQUAD_MAX_CARDS", 5),
  // Spend cap for one card, passed to claude --max-budget-usd.
  runBudgetUsd: num("SQUAD_RUN_BUDGET_USD", 5),
  // Spend cap for one squad agent across all its cards.
  totalBudgetUsd: num("SQUAD_TOTAL_BUDGET_USD", 25),
  runTimeoutMin: num("SQUAD_RUN_TIMEOUT_MIN", 45),
  idleSeconds: num("SQUAD_IDLE_SECONDS", 300),
  cicdIntervalSeconds: num("CICD_INTERVAL_SECONDS", 120),
  cicdMaxMerges: num("CICD_MAX_MERGES", 40),
  model: process.env.SQUAD_MODEL || "",
};

mkdirSync(config.runDir, { recursive: true });

export const stopFile = join(config.runDir, "STOP");
export const stopRequested = () => existsSync(stopFile);

export function loadAgents() {
  const file = join(deployDir, ".generated", "agents.json");
  if (!existsSync(file)) {
    throw new Error("No .generated/agents.json: run ./setup.sh first");
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export const log = (tag, message) =>
  console.log(`${new Date().toISOString()} ${tag} ${message}`);

// Wakes early when run-squads.sh stop asks.
export async function sleep(seconds) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until && !stopRequested()) {
    await new Promise((done) => setTimeout(done, 2000));
  }
}
