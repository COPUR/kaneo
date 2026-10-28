// Turns a backlog row into a Kaneo card: which board, column, priority,
// labels and description. Pure, so backlog.mjs stays about API calls.

import { ownerSquads, repos, squadForRepo } from "./repos.mjs";
import { squads, tribe } from "./squads.mjs";

const iterationNumber = (it) => {
  const match = /^I(\d+)$/i.exec(it ?? "");
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

// The current iteration is urgent, the next one is planned, the rest waits.
export function priorityFor(iteration, current) {
  const gap = iterationNumber(iteration) - iterationNumber(current);
  if (gap <= 0) return "high";
  if (gap === 1) return "medium";
  return "low";
}

const isYes = (value) => /^(yes|true|y)$/i.test((value ?? "").trim());
const list = (value) =>
  (value ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

// Row columns: Epic, Id, Title, Status, Iteration, Repository, Owner, Points,
// Human gate, Depends on, Body (the EV_PNC_docs kanban CSV shape).
export function planCard(row, { currentIteration }) {
  const repo = squadForRepo(row.Repository ?? "");
  const humanGate = isYes(row["Human gate"]);
  const toDecisions = humanGate && /product owner/i.test(row.Owner ?? "");
  const squadId =
    ownerSquads[row.Owner] ?? repo?.squad ?? (toDecisions ? null : "platform");
  const board = toDecisions
    ? tribe.decisions.key
    : squads.find((s) => s.id === squadId).key;

  const labels = [`it:${row.Iteration || "later"}`];
  if (repo?.chapter) labels.push(repo.chapter);
  if (humanGate) labels.push(toDecisions ? "decision" : "needs-human");

  const facts = [
    ["Epic", row.Epic],
    ["Repository", row.Repository],
    ["Owner", row.Owner],
    ["Points", row.Points],
    ["Iteration", row.Iteration],
    ["Depends on", list(row["Depends on"]).join(", ")],
  ].filter(([, value]) => value);

  return {
    id: row.Id,
    board,
    // Every board's first column keeps the to-do slug (Backlog / Proposed).
    status: "to-do",
    title: `[${row.Id}] ${row.Title}`,
    priority: priorityFor(row.Iteration, currentIteration),
    labels,
    dependsOn: list(row["Depends on"]),
    description: [
      facts.map(([k, v]) => `**${k}:** ${v}`).join("  \n"),
      row.Body?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// One card per existing repository: the thinnest slice that builds, tests and
// ships through the single CI/CD agent, before feature work starts there.
export function walkingSkeletons({ currentIteration }) {
  return repos
    .filter((r) => !r.planned)
    .map((r) =>
      planCard(
        {
          Id: `WS-${r.repo.replace(/^EV_PN?C_?/i, "").replace(/_/g, "-")}`,
          Title: `Walking skeleton for ${r.repo}`,
          Iteration: currentIteration,
          Repository: r.repo,
          Owner: `${r.squad} squad`,
          Points: "2",
          Body: [
            "Acceptance criteria:",
            "- [ ] main is protected: only the CI/CD agent merges (single-committer ruleset)",
            "- [ ] CI runs lint, tests and the secrets scan on every pull request",
            "- [ ] README names the owning squad, how to run it and how to test it",
            "- [ ] One end-to-end smoke test runs in CI",
            "- [ ] Lead time and deployment frequency are recorded from the first merge",
          ].join("\n"),
        },
        { currentIteration },
      ),
    );
}
