// Runs one headless Claude Code session (claude -p) for one card.

import { spawn } from "node:child_process";

// Tools a squad agent may use without asking. Pushing, merging and pull
// requests are left to the runner and the CI/CD agent.
const ALLOWED = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "TodoWrite",
  "mcp__kaneo",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git mv:*)",
  "Bash(git rm:*)",
  "Bash(git restore:*)",
  "Bash(ls:*)",
  "Bash(cat:*)",
  "Bash(head:*)",
  "Bash(tail:*)",
  "Bash(wc:*)",
  "Bash(find:*)",
  "Bash(grep:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(touch:*)",
  "Bash(node:*)",
  "Bash(npm:*)",
  "Bash(npx:*)",
  "Bash(pnpm:*)",
  "Bash(yarn:*)",
  "Bash(make:*)",
  "Bash(python3:*)",
  "Bash(uv:*)",
  "Bash(go:*)",
  "Bash(cargo:*)",
  "Bash(mvn:*)",
  "Bash(./mvnw:*)",
  "Bash(gradle:*)",
  "Bash(./gradlew:*)",
  "Bash(java:*)",
  "Bash(terraform fmt:*)",
  "Bash(terraform validate:*)",
  "Bash(helm lint:*)",
  "Bash(helm template:*)",
];

const DENIED = [
  "Bash(git push:*)",
  "Bash(git reset --hard:*)",
  "Bash(git checkout main:*)",
  "Bash(git switch main:*)",
  "Bash(gh:*)",
  "Bash(sudo:*)",
  "Bash(curl:*)",
  "Bash(rm -rf:*)",
  "mcp__kaneo__delete_task",
  "mcp__kaneo__delete_project",
  "mcp__kaneo__update_project",
];

const list = (value, fallback) =>
  value ? value.split(/\s*,\s*/).filter(Boolean) : fallback;

export function claudeArgs({
  prompt,
  systemPrompt,
  mcpConfig,
  budgetUsd,
  model,
  addDirs = [],
}) {
  return [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--append-system-prompt",
    systemPrompt,
    "--mcp-config",
    mcpConfig,
    "--strict-mcp-config",
    "--max-budget-usd",
    String(budgetUsd),
    "--allowedTools",
    ...list(process.env.SQUAD_ALLOWED_TOOLS, ALLOWED),
    "--disallowedTools",
    ...DENIED,
    ...addDirs.flatMap((dir) => ["--add-dir", dir]),
    ...(model ? ["--model", model] : []),
  ];
}

let active;
// run-squads.sh stop sends SIGTERM to the runner; take the session down too.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    active?.kill("SIGTERM");
    process.exit(143);
  });
}

export function runClaude(args, { cwd, timeoutMin }) {
  return new Promise((resolvePromise) => {
    const child = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    active = child;
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMin * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      active = undefined;
      let result = {};
      try {
        result = JSON.parse(out);
      } catch {
        result = { is_error: true, result: (err || out).slice(-2000) };
      }
      resolvePromise({
        ok: code === 0 && !result.is_error,
        code,
        text: result.result ?? "",
        costUsd: Number(result.total_cost_usd) || 0,
        subtype: result.subtype,
        stderr: err.slice(-2000),
      });
    });
  });
}
