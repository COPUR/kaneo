import assert from "node:assert/strict";
import { test } from "node:test";
import { planCard, priorityFor, walkingSkeletons } from "./plan.mjs";

const opts = { currentIteration: "I3" };

test("priority follows the iteration", () => {
  assert.equal(priorityFor("I3", "I3"), "high");
  assert.equal(priorityFor("I4", "I3"), "medium");
  assert.equal(priorityFor("later", "I3"), "low");
});

test("a product-owner gate goes to the decisions board", () => {
  const card = planCard(
    {
      Id: "X-01",
      Title: "Accept ADRs",
      Iteration: "I3",
      Repository: "EV_PNC_docs",
      Owner: "Product owner",
      "Human gate": "yes",
    },
    opts,
  );
  assert.equal(card.board, "DEC");
  assert.equal(card.title, "[X-01] Accept ADRs");
  assert.ok(card.labels.includes("decision"));
});

test("work goes to the squad that owns the repository", () => {
  const card = planCard(
    {
      Id: "X-08",
      Title: "Read model",
      Iteration: "later",
      Repository: "EV_PNC_hub-gateway",
      Owner: "Backend agent",
      "Human gate": "no",
      "Depends on": "H-05;X-03",
    },
    opts,
  );
  assert.equal(card.board, "ROA");
  assert.equal(card.priority, "low");
  assert.deepEqual(card.dependsOn, ["H-05", "X-03"]);
  assert.deepEqual(card.labels, ["it:later", "chapter:backend"]);
});

test("an owner mapping beats the repository", () => {
  const card = planCard(
    {
      Id: "X-09",
      Title: "Privacy lint",
      Repository: "EV_PNC_docs",
      Owner: "Compliance agent",
      "Human gate": "yes",
    },
    opts,
  );
  assert.equal(card.board, "SEC");
  assert.ok(card.labels.includes("needs-human"));
});

test("walking skeletons cover only repositories that exist", () => {
  const cards = walkingSkeletons(opts);
  assert.equal(cards.length, 16);
  assert.ok(cards.every((c) => !c.title.includes("planner")));
  assert.ok(
    cards.some((c) => c.id === "WS-Consent-registry" && c.board === "CON"),
  );
});

test("cards of planned repositories go to the owning squad, not Platform", () => {
  const row = (Repository) => ({
    Id: "T-01",
    Title: "Task",
    Iteration: "I1",
    Repository,
    Owner: "Backend agent",
    "Human gate": "no",
  });
  assert.equal(planCard(row("EV_PNC_mobile"), opts).board, "NAV");
  assert.equal(planCard(row("EV_PNC_plugcharge"), opts).board, "PAY");
  assert.equal(planCard(row("EV_PNC_national-data"), opts).board, "TEL");
  assert.equal(planCard(row("EV_PnC_Consent_notices"), opts).board, "CON");
});

test("planned repositories get no walking skeleton", () => {
  const ids = walkingSkeletons(opts).map((c) => c.id);
  assert.ok(!ids.some((id) => /mobile|plugcharge/i.test(id)));
});
