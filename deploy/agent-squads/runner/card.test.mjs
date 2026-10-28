import assert from "node:assert/strict";
import { test } from "node:test";
import {
  branchName,
  repoForCard,
  repoFromDescription,
  splitPullRequest,
} from "./card.mjs";

test("reads the repository backlog.mjs wrote", () => {
  assert.equal(
    repoFromDescription(
      "**Epic:** E1  \n**Repository:** EV_PNC_telemetry  \n**Owner:** x",
    ),
    "EV_PNC_telemetry",
  );
  assert.equal(repoFromDescription("no facts"), null);
});

test("falls back to the squad's first existing repository", () => {
  assert.deepEqual(repoForCard({ description: "" }, "consent"), {
    repo: "EV_PnC_Consent_contracts",
    planned: false,
  });
  assert.deepEqual(repoForCard({ description: "" }, "navigation"), {
    repo: "EV_PNC_planner",
    planned: true,
  });
  assert.equal(repoForCard({ description: "" }, "security"), null);
});

test("matches repository names without case", () => {
  assert.deepEqual(
    repoForCard({ description: "**Repository:** ev_pnc_docs" }, "platform"),
    {
      repo: "EV_PNC_docs",
      planned: false,
    },
  );
});

test("branch names carry the board, number and a short slug", () => {
  assert.equal(
    branchName("TEL", {
      number: 7,
      title: "[K-12] Add Kafka topic for meter values!",
    }),
    "squad/tel-7-add-kafka-topic-for-meter-values",
  );
  assert.equal(branchName("PLT", { number: 3, title: "[X]" }), "squad/plt-3");
});

test("the final message becomes the pull request", () => {
  assert.deepEqual(
    splitPullRequest("# feat: add x\n\n## Summary\nDone", "fallback"),
    {
      title: "feat: add x",
      body: "## Summary\nDone",
    },
  );
  assert.equal(splitPullRequest("", "fallback").title, "fallback");
});
