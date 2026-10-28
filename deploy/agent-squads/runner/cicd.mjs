#!/usr/bin/env node
// The CI/CD agent: the only one that merges and closes. Every few minutes it
// looks at In Review on each squad board, reads the card's Pull request, and
// merges when the approver agent's rules (scripts/agent-approver/rules.mjs)
// and GitHub agree (merge-policy.mjs). Then it moves the card to Done, which
// only its cicd-agent role may do. A pull request that needs a person gets the
// needs-human label and waits.
//
//   node runner/cicd.mjs

import { evaluate } from "../../../scripts/agent-approver/rules.mjs";
import { openBoard } from "../board.mjs";
import { squads } from "../squads.mjs";
import { cardRef } from "./card.mjs";
import { config, loadAgents, log, sleep, stopRequested } from "./config.mjs";
import { run } from "./git.mjs";
import { mergeDecision } from "./merge-policy.mjs";

const agent = loadAgents()["cicd-agent"];
const say = (message) => log("CICD", message);
const gh = (...args) => run("gh", args);

const FIELDS =
  "number,url,state,isDraft,reviewDecision,labels,statusCheckRollup,headRefOid,mergeable,files";

function gate(pr) {
  const files = (pr.files ?? []).map((f) => ({
    path: f.path,
    added: f.additions,
    removed: f.deletions,
    binary: false,
  }));
  const addedLines = gh("pr", "diff", pr.url)
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  return evaluate({ files, addedLines });
}

function flagForPerson(pr, reasons) {
  const repo = pr.url.replace(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/.*/,
    "$1",
  );
  try {
    gh(
      "label",
      "create",
      "needs-human",
      "--repo",
      repo,
      "--color",
      "f59e0b",
      "--force",
    );
  } catch {
    // Labels may be managed elsewhere; adding it below is what matters.
  }
  gh("pr", "edit", pr.url, "--add-label", "needs-human");
  gh(
    "pr",
    "comment",
    pr.url,
    "--body",
    `CI/CD agent: not merging on my own.\n\n${reasons.map((r) => `- ${r}`).join("\n")}\n\nA person decides: approve this pull request and remove \`needs-human\`, and the CI/CD agent merges it.`,
  );
}

async function review(board, squad, task) {
  const ref = cardRef(squad.key, task);
  const url = await board.field(task.id, "Pull request");
  if (!url) return say(`${ref} is In Review without a pull request`);

  const pr = JSON.parse(gh("pr", "view", url, "--json", FIELDS));
  const decision = mergeDecision(pr, pr.state === "OPEN" ? gate(pr) : {});
  switch (decision.action) {
    case "merge":
      gh(
        "pr",
        "merge",
        url,
        "--squash",
        "--delete-branch",
        "--match-head-commit",
        pr.headRefOid,
      );
      await board.move(task.id, "done");
      await board.comment(
        task.id,
        `${agent.name} merged ${url} and closed the card.`,
      );
      say(`${ref} merged ${url}`);
      return "merged";
    case "done":
      await board.move(task.id, "done");
      await board.comment(
        task.id,
        `${url} was merged; ${agent.name} closed the card.`,
      );
      say(`${ref} closed (already merged)`);
      return;
    case "closed":
      await board.move(task.id, "decision-needed");
      await board.setField(task.id, "Agent status", "Blocked");
      await board.comment(
        task.id,
        `${url} was closed without merging; ${agent.name} moved the card to Decision Needed.`,
      );
      say(`${ref} pull request closed; card to Decision Needed`);
      return;
    case "human":
      flagForPerson(pr, decision.reasons);
      await board.comment(
        task.id,
        `${agent.name}: ${url} needs a person before it can merge (${decision.reasons.join(" ")})`,
      );
      say(`${ref} needs a person: ${decision.reasons.join(" ")}`);
      return;
    default:
      say(`${ref} waits: ${decision.reason}`);
  }
}

let merges = 0;
say(
  `started: every ${config.cicdIntervalSeconds}s, up to ${config.cicdMaxMerges} merges`,
);
while (!stopRequested() && merges < config.cicdMaxMerges) {
  for (const squad of squads) {
    try {
      const board = await openBoard(agent, squad.key);
      for (const task of await board.tasksIn("in-review")) {
        try {
          if ((await review(board, squad, task)) === "merged") merges++;
        } catch (error) {
          say(`${cardRef(squad.key, task)} error: ${error.message}`);
        }
      }
    } catch (error) {
      say(`${squad.key} error: ${error.message}`);
    }
  }
  await sleep(config.cicdIntervalSeconds);
}
say(`stopped after ${merges} merge(s)`);
