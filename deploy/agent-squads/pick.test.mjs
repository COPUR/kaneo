import assert from "node:assert/strict";
import { test } from "node:test";
import { pickNext } from "./pick.mjs";

const task = (id, priority, number, extra = {}) => ({
  id,
  priority,
  number,
  userId: null,
  ...extra,
});
const blockedBy = (target, done) => [
  {
    relationType: "blocks",
    targetTaskId: target,
    sourceTask: { isCompleted: done },
  },
];

test("takes the most urgent, then the oldest", () => {
  const tasks = [
    task("a", "low", 1),
    task("b", "high", 3),
    task("c", "high", 2),
  ];
  assert.equal(pickNext(tasks, new Map()).id, "c");
});

test("skips blocked and already assigned cards", () => {
  const tasks = [
    task("a", "high", 1, { userId: "someone" }),
    task("b", "high", 2),
    task("c", "low", 3),
  ];
  const blockers = new Map([["b", blockedBy("b", false)]]);
  assert.equal(pickNext(tasks, blockers).id, "c");
});

test("a finished blocker no longer blocks", () => {
  const blockers = new Map([["b", blockedBy("b", true)]]);
  assert.equal(pickNext([task("b", "high", 1)], blockers).id, "b");
});

test("nothing to take", () => {
  assert.equal(pickNext([], new Map()), undefined);
});
