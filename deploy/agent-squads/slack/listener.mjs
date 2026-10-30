#!/usr/bin/env node
// Slack listener agent: turns Slack requests into Kaneo cards.
//
//   node slack/listener.mjs      # or: docker compose --profile slack up -d
//
// Connects with Socket Mode (no public URL). A mention of the bot, a direct
// message, or any top-level message in SLACK_CARD_CHANNELS becomes a card in
// the Backlog of the squad it routes to (slack/route.mjs), or Proposed on DEC
// for decisions. It replies in the Slack thread with the card's link. Later
// replies in that thread become comments on the card; "status" asks for its
// column. It acts as its own Kaneo agent (slack-agent, a plain member), so it
// can never move a card to Done: only the CI/CD agent closes work.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { client, loadEnv, urls, waitForApi } from "../lib.mjs";
import { tribe } from "../squads.mjs";
import { slackApi } from "./api.mjs";
import {
  cardDescription,
  parseChannelBoards,
  plainText,
  routeMessage,
  threadCommand,
} from "./route.mjs";
import { listen } from "./socket.mjs";
import { threadStore } from "./threads.mjs";

const deployDir = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(join(deployDir, ".env"));

const log = (message) =>
  console.log(`${new Date().toISOString()} SLACK ${message}`);

function setting(name, prefix) {
  const value = process.env[name];
  if (!value?.startsWith(prefix)) {
    throw new Error(
      `Set ${name} (${prefix}...) in deploy/agent-squads/.env; see slack/README.md`,
    );
  }
  return value;
}

const botToken = setting("SLACK_BOT_TOKEN", "xoxb-");
const appToken = setting("SLACK_APP_TOKEN", "xapp-");
const defaultBoard = (process.env.SLACK_DEFAULT_BOARD || "PLT").toUpperCase();
const channelBoards = parseChannelBoards(process.env.SLACK_CHANNEL_BOARDS);
const cardChannels = new Set(
  (process.env.SLACK_CARD_CHANNELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const agentsFile = join(deployDir, ".generated", "agents.json");
const agent = existsSync(agentsFile)
  ? JSON.parse(readFileSync(agentsFile, "utf8"))["slack-agent"]
  : null;
if (!agent?.apiKey) {
  throw new Error(
    "No slack-agent in .generated/agents.json: run node seed.mjs",
  );
}

const slack = slackApi(botToken);
const kaneo = client({ apiKey: agent.apiKey });
const store = threadStore(
  process.env.SLACK_STATE_FILE ||
    join(deployDir, ".runner", "slack-threads.json"),
  log,
);

const usage = [
  "Mention me with a request and I put it on a Kaneo board.",
  "• `CON: add revoke endpoint` picks the board (NAV CON ROA TEL PLT INV PAY SEC DEC).",
  "• Words like decision or karar go to DEC; a repository or squad name picks its squad.",
  "• `urgent` or `acil` makes it urgent.",
  "• In the card's thread: replies become comments, `status` shows its column.",
  "Only the CI/CD agent moves cards to Done.",
].join("\n");

// Workspace and boards as the slack-agent sees them; refreshed on a miss.
let boards = null;
async function board(key) {
  if (!boards?.byKey.has(key)) {
    const { data: workspaces } = await kaneo("GET", "/workspace");
    const workspace = workspaces.find((w) => w.slug === tribe.slug);
    if (!workspace) throw new Error(`slack-agent cannot see ${tribe.name}`);
    const { data: projects } = await kaneo(
      "GET",
      `/project?workspaceId=${workspace.id}`,
    );
    boards = { workspace, byKey: new Map(projects.map((p) => [p.slug, p])) };
  }
  const project = boards.byKey.get(key);
  if (!project) throw new Error(`slack-agent cannot see board ${key}`);
  return { workspace: boards.workspace, project };
}

const names = new Map();
async function authorName(userId) {
  if (!names.has(userId)) {
    try {
      const { user } = await slack("users.info", { user: userId });
      names.set(
        userId,
        user.profile?.display_name || user.real_name || user.name,
      );
    } catch {
      names.set(userId, userId);
    }
  }
  return names.get(userId);
}

const reply = (event, text) =>
  slack("chat.postMessage", {
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text,
    unfurl_links: false,
  });

async function createCard(event) {
  const route = routeMessage(event.text, {
    channelBoard: channelBoards.get(event.channel),
    defaultBoard,
  });
  const { workspace, project } = await board(route.board);
  let permalink = null;
  try {
    ({ permalink } = await slack("chat.getPermalink", {
      channel: event.channel,
      message_ts: event.ts,
    }));
  } catch {
    // The card still gets made without the link.
  }
  // New cards land in the first column: Backlog on squads, Proposed on DEC.
  const { data: task } = await kaneo("POST", `/task/${project.id}`, {
    title: route.title,
    description: cardDescription({
      details: route.details,
      repo: route.repo,
      author: await authorName(event.user),
      permalink,
    }),
    priority: route.priority,
    status: "to-do",
  });
  const ref = `${route.board}-${task.number}`;
  const link = `${urls().clientUrl}/dashboard/workspace/${workspace.id}/project/${project.id}/task/${task.id}`;
  store.set(event.channel, event.thread_ts ?? event.ts, {
    taskId: task.id,
    board: route.board,
    projectId: project.id,
    ref,
  });
  const where = route.board === tribe.decisions.key ? "Proposed" : "Backlog";
  await reply(event, `Created <${link}|${ref}> in ${where}: ${route.title}`);
  log(`${ref} from ${event.channel}/${event.ts}`);
}

async function columnName(card) {
  const { data: task } = await kaneo("GET", `/task/${card.taskId}`);
  const { data: columns } = await kaneo("GET", `/column/${card.projectId}`);
  return columns.find((c) => c.slug === task.status)?.name ?? task.status;
}

async function onThreadReply(event, card) {
  const command = threadCommand(event.text);
  if (command === "status") {
    return reply(event, `${card.ref} is in ${await columnName(card)}.`);
  }
  if (command === "help") return reply(event, usage);
  if (command === "close") {
    return reply(
      event,
      `I cannot close ${card.ref}. Only the CI/CD agent moves it to Done, after its pull request merges.`,
    );
  }
  const text = plainText(event.text);
  if (!text) return;
  await kaneo("POST", `/comment/${card.taskId}`, {
    content: `**${await authorName(event.user)} on Slack:** ${text}`,
  });
  await slack("reactions.add", {
    channel: event.channel,
    timestamp: event.ts,
    name: "memo",
  }).catch(() => {});
}

async function onMessage(event, { mentioned }) {
  if (event.thread_ts) {
    const card = store.get(event.channel, event.thread_ts);
    if (card) return onThreadReply(event, card);
  }
  const listening =
    mentioned || (cardChannels.has(event.channel) && !event.thread_ts);
  if (!listening) return;
  if (threadCommand(event.text) === "help" || !plainText(event.text)) {
    return reply(event, usage);
  }
  try {
    await createCard(event);
  } catch (error) {
    await reply(event, `Could not create a card: ${error.message}`);
    throw error;
  }
}

const seen = new Set();
let botUserId = null;

async function onEvent({ event, event_id: id }) {
  if (!event || seen.has(id)) return;
  seen.add(id);
  if (seen.size > 1000) seen.delete(seen.values().next().value);
  if (event.bot_id || event.user === botUserId || !event.user) return;

  if (event.type === "app_mention")
    return onMessage(event, { mentioned: true });
  if (event.type !== "message" || event.subtype) return;
  // A mention in a channel also arrives as app_mention; handle it once.
  if (event.channel_type !== "im" && event.text?.includes(`<@${botUserId}>`)) {
    return;
  }
  return onMessage(event, { mentioned: event.channel_type === "im" });
}

async function main() {
  await waitForApi();
  await board(defaultBoard);
  ({ user_id: botUserId } = await slack("auth.test"));
  log(
    `listening as ${botUserId}; default board ${defaultBoard}; card channels: ${[...cardChannels].join(", ") || "none (mentions and DMs only)"}`,
  );
  await listen(appToken, onEvent, { log });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
