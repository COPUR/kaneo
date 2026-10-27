// The approver agent's rules, kept apart from git so they can be tested.
// Change them only through a pull request a person approves: edits here are
// themselves on the needs-a-person list.

// Small batches are cheap to review and to revert; past this, a person looks.
export const MAX_CHANGED_LINES = 1500;
export const HOTSPOT_COMMITS = 10;

// Paths whose changes need a person: the gate itself, pipelines, and the
// places that decide who may do what or that change stored data.
export const HUMAN_PATHS = [
  /^\.github\//,
  /^scripts\/agent-approver\//,
  /^apps\/api\/drizzle\//,
  /^apps\/api\/src\/database\/schema\.ts$/,
  /^apps\/api\/src\/auth\.ts$/,
  /^deploy\/agent-squads\/github\//,
];

// Paths that touch authorization but stay automatic when tests pass; the report
// calls them out so a reader knows where to look.
export const SENSITIVE_PATHS = [
  /^packages\/permissions\//,
  /require-.*permission/,
  /^apps\/api\/src\/utils\/(require-workspace-permission|role-permissions)\.ts$/,
];

const SECRET_PATTERNS = [
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Slack token", pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "Anthropic or OpenAI key",
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,})\b/,
  },
];

const isSource = (path) =>
  /^(apps|packages)\/.+\.(ts|tsx)$/.test(path) &&
  !/\.(test|spec)\.tsx?$/.test(path) &&
  !path.endsWith(".d.ts");
const isTest = (path) => /\.(test|spec)\.tsx?$/.test(path);

export function evaluate({ files, addedLines, churn = new Map() }) {
  const blockers = [];
  const notes = [];
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);

  if (files.length === 0) blockers.push("The diff is empty.");

  if (added + removed > MAX_CHANGED_LINES) {
    blockers.push(
      `${added + removed} changed lines is over the ${MAX_CHANGED_LINES}-line limit. Split it into smaller pull requests.`,
    );
  }

  for (const file of files) {
    if (HUMAN_PATHS.some((pattern) => pattern.test(file.path))) {
      blockers.push(`\`${file.path}\` is on the needs-a-person list.`);
    }
    if (file.binary) notes.push(`\`${file.path}\` is binary.`);
  }

  for (const { name, pattern } of SECRET_PATTERNS) {
    if (addedLines.some((line) => pattern.test(line))) {
      blockers.push(
        `An added line looks like a ${name}. Remove and rotate it.`,
      );
    }
  }

  const sensitive = files.filter((file) =>
    SENSITIVE_PATHS.some((pattern) => pattern.test(file.path)),
  );
  if (sensitive.length) {
    notes.push(
      `Touches authorization: ${sensitive.map((f) => `\`${f.path}\``).join(", ")}.`,
    );
  }

  const sourceChanged = files.some((file) => isSource(file.path));
  if (sourceChanged && !files.some((file) => isTest(file.path))) {
    notes.push("Source changed without a test change.");
  }

  const hotspots = files
    .map((file) => ({ path: file.path, commits: churn.get(file.path) ?? 0 }))
    .filter((file) => file.commits >= HOTSPOT_COMMITS)
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 5);

  return {
    verdict: blockers.length ? "human" : "approve",
    blockers: [...new Set(blockers)],
    notes,
    hotspots,
    added,
    removed,
  };
}
