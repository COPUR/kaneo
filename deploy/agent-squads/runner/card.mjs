// Pure helpers that turn a Kaneo card into the repository and branch a squad
// agent works on.

import { repos } from "../repos.mjs";

// backlog.mjs writes "**Repository:** <name>" into every card it creates.
export function repoFromDescription(description) {
  const match = /\*\*Repository:\*\*\s*([A-Za-z0-9_.-]+)/.exec(
    description ?? "",
  );
  return match?.[1] ?? null;
}

// The card's repository, else the squad's first existing repository.
export function repoForCard(task, squadId) {
  const named = repoFromDescription(task.description);
  if (named) {
    const known = repos.find(
      (r) => r.repo.toLowerCase() === named.toLowerCase(),
    );
    return { repo: known?.repo ?? named, planned: Boolean(known?.planned) };
  }
  const fallback = repos.find((r) => r.squad === squadId && !r.planned);
  if (fallback) return { repo: fallback.repo, planned: false };
  const planned = repos.find((r) => r.squad === squadId);
  return planned ? { repo: planned.repo, planned: true } : null;
}

export function branchName(boardKey, task) {
  const slug = (task.title ?? "")
    .replace(/^\[[^\]]*\]\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `squad/${boardKey.toLowerCase()}-${task.number}${slug ? `-${slug}` : ""}`;
}

export const cardRef = (boardKey, task) => `${boardKey}-${task.number}`;

// The agent's final message is the pull request: first line the title,
// the rest the body.
export function splitPullRequest(text, fallbackTitle) {
  const lines = (text ?? "").trim().split("\n");
  const title = lines[0]?.replace(/^#+\s*/, "").trim() || fallbackTitle;
  const body = lines.slice(1).join("\n").trim();
  return { title: title.slice(0, 200), body };
}
