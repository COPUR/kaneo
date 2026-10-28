import assert from "node:assert/strict";
import { test } from "node:test";
import { checkState, mergeDecision } from "./merge-policy.mjs";

const green = {
  __typename: "CheckRun",
  status: "COMPLETED",
  conclusion: "SUCCESS",
};
const pass = { verdict: "approve", blockers: [] };
const open = (extra = {}) => ({
  state: "OPEN",
  isDraft: false,
  labels: [],
  reviewDecision: "",
  statusCheckRollup: [green],
  mergeable: "MERGEABLE",
  ...extra,
});

test("merges an open, green, mergeable pull request the gate passes", () => {
  assert.deepEqual(mergeDecision(open(), pass), { action: "merge" });
  assert.deepEqual(mergeDecision(open({ reviewDecision: "APPROVED" }), pass), {
    action: "merge",
  });
});

test("closes the card of a merged pull request", () => {
  assert.equal(mergeDecision({ state: "MERGED" }, {}).action, "done");
  assert.equal(mergeDecision({ state: "CLOSED" }, {}).action, "closed");
});

test("waits for drafts, people, reviews, checks and conflicts", () => {
  for (const extra of [
    { isDraft: true },
    { labels: [{ name: "needs-human" }] },
    { reviewDecision: "CHANGES_REQUESTED" },
    { reviewDecision: "REVIEW_REQUIRED" },
    { statusCheckRollup: [{ ...green, conclusion: "FAILURE" }] },
    { statusCheckRollup: [{ __typename: "CheckRun", status: "IN_PROGRESS" }] },
    { statusCheckRollup: [{ __typename: "StatusContext", state: "PENDING" }] },
    { mergeable: "CONFLICTING" },
    { mergeable: "UNKNOWN" },
  ]) {
    assert.equal(
      mergeDecision(open(extra), pass).action,
      "wait",
      JSON.stringify(extra),
    );
  }
});

test("hands the gate's blockers to a person unless a person approved", () => {
  const blocked = { verdict: "human", blockers: ["too big"] };
  assert.deepEqual(mergeDecision(open(), blocked), {
    action: "human",
    reasons: ["too big"],
  });
  assert.equal(
    mergeDecision(open({ reviewDecision: "APPROVED" }), blocked).action,
    "merge",
  );
});

test("counts check runs and status contexts", () => {
  assert.deepEqual(
    checkState([
      green,
      { __typename: "CheckRun", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "StatusContext", state: "ERROR" },
      { __typename: "StatusContext", state: "EXPECTED" },
    ]),
    { pending: 1, failed: 1, total: 4 },
  );
});
