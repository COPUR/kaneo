import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluate, MAX_CHANGED_LINES } from "./rules.mjs";

const file = (path, added = 10, removed = 0) => ({
  path,
  added,
  removed,
  binary: false,
});

test("approves a small change with tests", () => {
  const result = evaluate({
    files: [
      file("apps/api/src/task/get-task.ts"),
      file("apps/api/src/task/get-task.test.ts"),
    ],
    addedLines: ["+const x = 1;"],
  });
  assert.equal(result.verdict, "approve");
  assert.deepEqual(result.blockers, []);
});

test("sends changes to the gate and pipelines to a person", () => {
  for (const path of [
    ".github/workflows/agent-approver.yml",
    "scripts/agent-approver/rules.mjs",
    "apps/api/src/auth.ts",
  ]) {
    assert.equal(
      evaluate({ files: [file(path)], addedLines: [] }).verdict,
      "human",
    );
  }
});

test("sends large changes to a person", () => {
  const result = evaluate({
    files: [file("apps/web/src/a.tsx", MAX_CHANGED_LINES + 1)],
    addedLines: [],
  });
  assert.equal(result.verdict, "human");
});

test("blocks added lines that look like secrets", () => {
  const result = evaluate({
    files: [file("README.md")],
    addedLines: [`+token: ghp_${"a".repeat(36)}`],
  });
  assert.equal(result.verdict, "human");
});

test("notes authorization changes and missing tests without blocking", () => {
  const result = evaluate({
    files: [file("packages/permissions/src/index.ts")],
    addedLines: [],
  });
  assert.equal(result.verdict, "approve");
  assert.equal(result.notes.length, 2);
});

test("blocks an empty diff", () => {
  assert.equal(evaluate({ files: [], addedLines: [] }).verdict, "human");
});
