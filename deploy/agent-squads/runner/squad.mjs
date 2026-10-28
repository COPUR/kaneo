#!/usr/bin/env node
// One squad agent, working on its own: take the card in progress (or claim
// the next one, WIP 1), work on it with a headless Claude Code session in a
// worktree of the card's repository, then hand it on. Commits become a pull
// request and the card moves to In Review for the CI/CD agent; a decision
// moves it to Decision Needed. Stops at the card or budget cap, or on
// run-squads.sh stop.
//
//   node runner/squad.mjs <board key, e.g. CON>

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { currentOrClaim, openBoard } from "../board.mjs";
import { squads } from "../squads.mjs";
import { branchName, cardRef, repoForCard, splitPullRequest } from "./card.mjs";
import { claudeArgs, runClaude } from "./claude.mjs";
import {
  config,
  deployDir,
  loadAgents,
  log,
  sleep,
  stopRequested,
} from "./config.mjs";
import {
  addWorktree,
  commitsAhead,
  defaultBranch,
  ensureClone,
  isDirty,
  openPullRequest,
  pushBranch,
  removeWorktree,
  repoExists,
} from "./git.mjs";
import { cardPrompt, squadSystemPrompt } from "./prompt.mjs";

const key = (process.argv[2] ?? "").toUpperCase();
const squad = squads.find((s) => s.key === key);
if (!squad) {
  console.error(`usage: squad.mjs <${squads.map((s) => s.key).join("|")}>`);
  process.exit(2);
}
const agent = loadAgents()[`${squad.id}-agent`];
const mcpConfig = join(deployDir, ".generated", `${agent.id}.mcp-http.json`);
const say = (message) => log(key, message);

const DECISION = "decision-needed";
const docsDir = join(config.reposDir, "EV_PNC_docs");

async function handBack(board, task, reason) {
  await board.move(task.id, DECISION);
  await board.setField(task.id, "Agent status", "Blocked");
  await board.comment(
    task.id,
    `${agent.name}: ${reason} A person or a decision is needed before this continues.`,
  );
}

async function workOn(board, task) {
  const ref = cardRef(squad.key, task);
  const full = { ...task, ...(await board.task(task.id)) };
  const target = repoForCard(full, squad.id);
  const repo = {
    owner: config.githubOwner,
    repo: target?.repo ?? "(none)",
    exists: Boolean(target) && repoExists(config.githubOwner, target.repo),
  };
  const branch = branchName(squad.key, full);
  await board.setField(task.id, "Agent status", "Working");

  let clone;
  let worktree = join(config.runDir, "scratch", key);
  let base = "main";
  if (repo.exists) {
    clone = ensureClone(config.reposDir, repo.owner, repo.repo);
    base = defaultBranch(clone);
    worktree = addWorktree(
      clone,
      join(config.reposDir, ".squad-worktrees", key, `${ref}-${repo.repo}`),
      branch,
      base,
    );
  } else {
    mkdirSync(worktree, { recursive: true });
  }
  say(
    `${ref} ${full.title} -> ${repo.owner}/${repo.repo} (${repo.exists ? branch : "no repository"})`,
  );

  const result = await runClaude(
    claudeArgs({
      prompt: cardPrompt({
        squad,
        task: full,
        ref,
        repo,
        branch,
        base,
        decisionSlug: DECISION,
      }),
      systemPrompt: squadSystemPrompt({ squad, agent }),
      mcpConfig,
      budgetUsd: config.runBudgetUsd,
      model: config.model,
      addDirs:
        existsSync(docsDir) && repo.repo !== "EV_PNC_docs" ? [docsDir] : [],
    }),
    { cwd: worktree, timeoutMin: config.runTimeoutMin },
  );
  say(
    `${ref} session ${result.ok ? "finished" : `failed (${result.subtype ?? result.code})`}, $${result.costUsd.toFixed(2)}`,
  );
  if (!result.ok) say(`${ref} ${(result.text || result.stderr).slice(0, 500)}`);

  const status = await board.status(task.id);
  if (status === DECISION) {
    await board.setField(task.id, "Agent status", "Blocked");
    say(`${ref} waits on a decision`);
  } else if (status !== "in-progress") {
    say(`${ref} is now ${status}; leaving it there`);
  } else if (!repo.exists) {
    await handBack(
      board,
      task,
      `repository ${repo.owner}/${repo.repo} does not exist.`,
    );
  } else if (!result.ok) {
    // Keep the worktree so the half-done work can be looked at.
    await handBack(
      board,
      task,
      `the session stopped (${result.subtype ?? `exit ${result.code}`}) before finishing; work so far is in ${worktree}.`,
    );
    return result.costUsd;
  } else if (commitsAhead(worktree, base) === 0) {
    await handBack(board, task, "the session ended without a commit.");
  } else {
    if (isDirty(worktree))
      say(`${ref} has uncommitted changes; only commits are pushed`);
    pushBranch(worktree, branch);
    const pr = splitPullRequest(result.text, `${ref}: ${full.title}`);
    const bodyFile = join(config.runDir, `${key}.pr.md`);
    writeFileSync(
      bodyFile,
      `${pr.body}\n\nKaneo card: ${ref} (${squad.name}). Opened by ${agent.name}; the CI/CD agent merges after the approver agent's checks.\n`,
    );
    const url = openPullRequest({
      ...repo,
      branch,
      base,
      title: pr.title,
      bodyFile,
    });
    await board.setField(task.id, "Pull request", url);
    await board.move(task.id, "in-review");
    await board.setField(task.id, "Agent status", "Handed to CI/CD");
    await board.comment(
      task.id,
      `${agent.name} opened ${url} and handed the card to the CI/CD agent.`,
    );
    say(`${ref} -> In Review, ${url}`);
  }
  if (clone) removeWorktree(clone, worktree);
  return result.costUsd;
}

let cards = 0;
let spent = 0;
let errors = 0;
say(
  `started as ${agent.name}: up to ${config.maxCards} cards, $${config.totalBudgetUsd} in total, $${config.runBudgetUsd} per card`,
);
while (!stopRequested()) {
  if (cards >= config.maxCards) {
    say(`card cap reached (${cards}); stopping`);
    break;
  }
  if (spent + config.runBudgetUsd > config.totalBudgetUsd) {
    say(`budget cap reached ($${spent.toFixed(2)} spent); stopping`);
    break;
  }
  try {
    const board = await openBoard(agent, squad.key);
    const { task, claimed } = await currentOrClaim(board, agent);
    if (!task) {
      say(
        `nothing unblocked in Backlog; checking again in ${config.idleSeconds}s`,
      );
      await sleep(config.idleSeconds);
      continue;
    }
    if (claimed) say(`claimed ${cardRef(squad.key, task)} ${task.title}`);
    spent += await workOn(board, task);
    cards++;
    errors = 0;
  } catch (error) {
    say(`error: ${error.message}`);
    if (++errors >= 5) {
      say("5 errors in a row; stopping");
      process.exitCode = 1;
      break;
    }
    await sleep(60);
  }
}
say(`stopped after ${cards} card(s), $${spent.toFixed(2)}`);
