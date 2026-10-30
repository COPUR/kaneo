import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardDescription,
  parseChannelBoards,
  plainText,
  routeMessage,
  threadCommand,
} from "./route.mjs";

test("plainText drops mentions and keeps link labels", () => {
  assert.equal(
    plainText(
      "<@U01ABC> fix <https://x.io/a|the docs> in <#C1|eng> &amp; more",
    ),
    "fix the docs (https://x.io/a) in #eng & more",
  );
});

test("an explicit board key wins and is removed from the title", () => {
  const r = routeMessage("<@U1> CON: add consent revoke endpoint");
  assert.equal(r.board, "CON");
  assert.equal(r.title, "add consent revoke endpoint");
  assert.equal(routeMessage("[tel] dashboards").board, "TEL");
});

test("unknown three-letter prefixes are not boards", () => {
  const r = routeMessage("FYI: something broke", { defaultBoard: "PLT" });
  assert.equal(r.board, "PLT");
  assert.equal(r.title, "FYI: something broke");
});

test("decision words go to DEC", () => {
  assert.equal(
    routeMessage("we need a decision on Kafka retention").board,
    "DEC",
  );
  assert.equal(routeMessage("Kafka için karar lazım").board, "DEC");
});

test("a repository name picks its squad and is kept for the runner", () => {
  const r = routeMessage("EV_PNC_hub-gateway returns 502 on /locations");
  assert.equal(r.board, "ROA");
  assert.equal(r.repo, "EV_PNC_hub-gateway");
});

test("a squad name picks its board", () => {
  assert.equal(routeMessage("telemetry gaps since monday").board, "TEL");
});

test("channel board, then default", () => {
  assert.equal(routeMessage("hello", { channelBoard: "SEC" }).board, "SEC");
  assert.equal(routeMessage("hello", { defaultBoard: "NAV" }).board, "NAV");
});

test("priority from words, title from the first line", () => {
  const r = routeMessage("ACIL: login down\nsince 9:00");
  assert.equal(r.priority, "urgent");
  assert.equal(r.title, "ACIL: login down");
  assert.equal(r.details, "since 9:00");
  assert.equal(routeMessage("x").priority, "medium");
});

test("long titles are clipped", () => {
  assert.equal(routeMessage("a".repeat(300)).title.length, 120);
});

test("cardDescription carries the repository line and the Slack link", () => {
  const d = cardDescription({
    details: "more",
    repo: "EV_PNC_docs",
    author: "Ada",
    permalink: "https://slack/p1",
  });
  assert.match(d, /\*\*Repository:\*\* EV_PNC_docs/);
  assert.match(d, /From Slack: Ada \(https:\/\/slack\/p1\)$/);
});

test("parseChannelBoards ignores unknown boards", () => {
  const map = parseChannelBoards("C1=con, C2=XYZ ,bad");
  assert.deepEqual([...map], [["C1", "CON"]]);
});

test("threadCommand", () => {
  assert.equal(threadCommand("<@U1> status?"), "status");
  assert.equal(threadCommand("durum"), "status");
  assert.equal(threadCommand("please close this"), "close");
  assert.equal(
    threadCommand("the close button overlaps the done label on mobile"),
    null,
  );
  assert.equal(threadCommand("looks good"), null);
});
