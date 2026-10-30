// Pure helpers that turn a Slack message into a Kaneo card: which board it
// goes on, its title, description and priority.

import { repos } from "../repos.mjs";
import { squads, tribe } from "../squads.mjs";

const boardKeys = [...squads.map((s) => s.key), tribe.decisions.key];

// Slack markup: <@U123>, <#C123|name>, <https://x|label>, <https://x>.
export function plainText(text) {
  return (text ?? "")
    .replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/g, "")
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// "CON: ..." or "[CON] ..." at the start names the board.
function explicitBoard(text) {
  const match = /^\[?([A-Za-z]{3})\]?\s*[:\]]\s*/.exec(text);
  const key = match?.[1].toUpperCase();
  if (!key || !boardKeys.includes(key)) return null;
  return { key, rest: text.slice(match[0].length) };
}

const decisionWords = /\b(decision|decide|karar|adr)\b/i;
const urgentWords = /\b(urgent|acil|asap|p0)\b/i;
const highWords = /\b(high|önemli|yüksek|p1)\b/i;

// Board for a message: an explicit key, then decision words (DEC), then a
// repository or squad name, then the channel's board, then the default.
export function routeMessage(
  text,
  { channelBoard, defaultBoard = "PLT" } = {},
) {
  let body = plainText(text);
  let board = null;
  let repo = null;
  const explicit = explicitBoard(body);
  if (explicit) {
    board = explicit.key;
    body = explicit.rest;
  }
  const lower = body.toLowerCase();
  const named = repos.find((r) => lower.includes(r.repo.toLowerCase()));
  if (named) repo = named.repo;
  if (!board && decisionWords.test(body)) board = tribe.decisions.key;
  if (!board && named) board = squadKey(named.squad);
  if (!board) {
    const squad = squads.find((s) =>
      new RegExp(`\\b${s.id}\\b`, "i").test(body),
    );
    if (squad) board = squad.key;
  }
  board ??= channelBoard ?? defaultBoard;

  const [first, ...more] = body.split("\n");
  const title = clip(first.trim() || "Request from Slack", 120);
  const priority = urgentWords.test(body)
    ? "urgent"
    : highWords.test(body)
      ? "high"
      : "medium";
  return { board, title, details: more.join("\n").trim(), repo, priority };
}

const squadKey = (id) => squads.find((s) => s.id === id)?.key ?? null;

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Card body. "**Repository:**" is what the squad runner reads to pick the repo.
export function cardDescription({ details, repo, author, permalink }) {
  const lines = [];
  if (details) lines.push(details, "");
  if (repo) lines.push(`**Repository:** ${repo}`, "");
  lines.push(`From Slack: ${author}${permalink ? ` (${permalink})` : ""}`);
  return lines.join("\n");
}

// "C123=CON,C456=TEL" from SLACK_CHANNEL_BOARDS.
export function parseChannelBoards(value) {
  const map = new Map();
  for (const pair of (value ?? "").split(",")) {
    const [channel, key] = pair.split("=").map((s) => s?.trim());
    if (channel && key && boardKeys.includes(key.toUpperCase())) {
      map.set(channel, key.toUpperCase());
    }
  }
  return map;
}

// Words in a card's Slack thread that ask the listener something instead of
// adding a comment.
export function threadCommand(text) {
  const t = plainText(text).toLowerCase();
  if (/^(status|durum)\??$/.test(t)) return "status";
  if (/^(help|yardım|yardim)\??$/.test(t)) return "help";
  if (/\b(close|done|kapat|bitir)\b/.test(t) && t.length < 40) return "close";
  return null;
}
