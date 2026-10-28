// When the CI/CD agent may merge a pull request. Pure, so it can be tested
// without GitHub. `pr` is `gh pr view --json` output; `gate` is the approver
// agent's verdict from scripts/agent-approver/rules.mjs.

const FAILED = new Set([
  "FAILURE",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "ERROR",
]);

export function checkState(rollup = []) {
  let pending = 0;
  let failed = 0;
  for (const check of rollup) {
    if (check.__typename === "StatusContext") {
      if (FAILED.has(check.state)) failed++;
      else if (check.state !== "SUCCESS") pending++;
    } else if (check.status !== "COMPLETED") pending++;
    else if (FAILED.has(check.conclusion)) failed++;
  }
  return { pending, failed, total: rollup.length };
}

export function mergeDecision(pr, gate) {
  if (pr.state === "MERGED") return { action: "done" };
  if (pr.state === "CLOSED") return { action: "closed" };
  if (pr.isDraft) return { action: "wait", reason: "draft" };
  if ((pr.labels ?? []).some((l) => l.name === "needs-human")) {
    return { action: "wait", reason: "labelled needs-human: a person decides" };
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return { action: "wait", reason: "changes requested" };
  }
  if (pr.reviewDecision === "REVIEW_REQUIRED") {
    return { action: "wait", reason: "waiting for the approver agent" };
  }
  const checks = checkState(pr.statusCheckRollup);
  if (checks.failed) {
    return { action: "wait", reason: `${checks.failed} check(s) failing` };
  }
  if (checks.pending) {
    return { action: "wait", reason: `${checks.pending} check(s) running` };
  }
  if (pr.mergeable !== "MERGEABLE") {
    return { action: "wait", reason: `mergeable is ${pr.mergeable}` };
  }
  // A person's approval on GitHub settles what the gate leaves to a person.
  if (gate.verdict !== "approve" && pr.reviewDecision !== "APPROVED") {
    return { action: "human", reasons: gate.blockers };
  }
  return { action: "merge" };
}
