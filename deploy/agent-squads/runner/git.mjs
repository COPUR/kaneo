// Git and GitHub CLI calls for the runners. Every squad agent gets its own
// worktree per card, so squads never share a working copy.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();

const git = (cwd, ...args) => run("git", args, { cwd });

export function repoExists(owner, repo) {
  try {
    run("gh", ["repo", "view", `${owner}/${repo}`, "--json", "name"]);
    return true;
  } catch {
    return false;
  }
}

// The main clone lives in reposDir (as on the Mac: ~/Downloads/<repo>).
export function ensureClone(reposDir, owner, repo) {
  const dir = join(reposDir, repo);
  if (!existsSync(join(dir, ".git"))) {
    run("gh", ["repo", "clone", `${owner}/${repo}`, dir]);
  }
  git(dir, "fetch", "--quiet", "origin");
  return dir;
}

export function defaultBranch(dir) {
  const head = () =>
    git(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(
      /^origin\//,
      "",
    );
  try {
    return head();
  } catch {
    git(dir, "remote", "set-head", "origin", "--auto");
    return head();
  }
}

// A fresh worktree for the card, continuing its branch if it was pushed
// before (for example after a stopped run).
export function addWorktree(cloneDir, worktreeDir, branch, base) {
  if (existsSync(worktreeDir)) return worktreeDir;
  mkdirSync(join(worktreeDir, ".."), { recursive: true });
  git(cloneDir, "worktree", "prune");
  const remote = git(cloneDir, "ls-remote", "--heads", "origin", branch);
  const local = git(cloneDir, "branch", "--list", branch);
  if (local) git(cloneDir, "worktree", "add", worktreeDir, branch);
  else if (remote) {
    git(cloneDir, "fetch", "--quiet", "origin", `${branch}:${branch}`);
    git(cloneDir, "worktree", "add", worktreeDir, branch);
  } else {
    git(
      cloneDir,
      "worktree",
      "add",
      "-b",
      branch,
      worktreeDir,
      `origin/${base}`,
    );
  }
  return worktreeDir;
}

export function removeWorktree(cloneDir, worktreeDir) {
  if (!existsSync(worktreeDir)) return;
  git(cloneDir, "worktree", "remove", "--force", worktreeDir);
}

export const commitsAhead = (worktreeDir, base) =>
  Number(git(worktreeDir, "rev-list", "--count", `origin/${base}..HEAD`));

export const isDirty = (worktreeDir) =>
  git(worktreeDir, "status", "--porcelain") !== "";

export function pushBranch(worktreeDir, branch) {
  git(
    worktreeDir,
    "push",
    "--quiet",
    "-u",
    "origin",
    `HEAD:refs/heads/${branch}`,
  );
}

// Opens the pull request, or returns the open one for this branch.
export function openPullRequest({
  owner,
  repo,
  branch,
  base,
  title,
  bodyFile,
}) {
  const slug = `${owner}/${repo}`;
  const existing = run("gh", [
    "pr",
    "list",
    "--repo",
    slug,
    "--head",
    branch,
    "--state",
    "open",
    "--json",
    "url",
    "--jq",
    ".[0].url // empty",
  ]);
  if (existing) return existing;
  return run("gh", [
    "pr",
    "create",
    "--repo",
    slug,
    "--head",
    branch,
    "--base",
    base,
    "--title",
    title,
    "--body-file",
    bodyFile,
  ])
    .split("\n")
    .pop();
}
