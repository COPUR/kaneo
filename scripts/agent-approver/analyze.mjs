#!/usr/bin/env node
// Code analysis gate for the CI approver agent. Reads the diff between two
// commits and decides whether the agent may approve on its own, or a person
// has to look first. Writes a Markdown report and a verdict for the workflow.
//
//   node scripts/agent-approver/analyze.mjs <base-sha> <head-sha>
//
// Verdicts: "approve" (the agent approves after the checks pass) or "human"
// (the agent comments and labels the pull request needs-human).

import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { evaluate } from "./rules.mjs";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("usage: analyze.mjs <base-sha> <head-sha>");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const files = git("diff", "--numstat", "-M", `${base}...${head}`)
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [added, removed, ...path] = line.split("\t");
    return {
      path: path.join("\t"),
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
      binary: added === "-",
    };
  });

const addedLines = git("diff", "-U0", `${base}...${head}`)
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

// Churn over the last 90 days on the base branch marks hotspots: changes there
// carry more risk than changes to cold code.
const churn = new Map();
for (const path of git(
  "log",
  "--since=90.days",
  "--format=",
  "--name-only",
  base,
).split("\n")) {
  if (path) churn.set(path, (churn.get(path) ?? 0) + 1);
}

const result = evaluate({ files, addedLines, churn });

const report = [
  `## Approver agent: ${result.verdict === "approve" ? "can approve" : "needs a person"}`,
  "",
  `${files.length} files, +${result.added} −${result.removed} lines.`,
  "",
  ...(result.blockers.length
    ? [
        "**Needs a person because:**",
        ...result.blockers.map((b) => `- ${b}`),
        "",
      ]
    : []),
  ...(result.notes.length
    ? ["**Notes:**", ...result.notes.map((n) => `- ${n}`), ""]
    : []),
  ...(result.hotspots.length
    ? [
        "**Hotspots touched** (commits in the last 90 days):",
        ...result.hotspots.map((h) => `- \`${h.path}\`: ${h.commits}`),
        "",
      ]
    : []),
].join("\n");

writeFileSync("approver-report.md", `${report}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${result.verdict}\n`);
}
console.log(report);
