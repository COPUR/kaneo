#!/usr/bin/env bash
# Lets only the CI/CD agent change each repository's default branch.
#
# Creates (or updates) a repository ruleset named "single-committer" that
# blocks pushes, merges, force-pushes and deletion on the default branch for
# everyone except one GitHub App: the app the CI/CD agent runs as. Squad agents
# still push their own branches and open pull requests; the CI/CD agent merges.
#
# A second ruleset, "approval-required", has no bypass: every change reaches the
# default branch through a pull request with one approval, and a push after the
# approval dismisses it. The approver agent (.github/workflows/agent-approver.yml)
# gives that approval, so the CI/CD agent cannot merge unreviewed work.
#
# Usage:
#   CICD_APP_ID=123456 ./single-committer.sh OWNER/REPO [OWNER/REPO ...]   # dry run
#   CICD_APP_ID=123456 APPLY=1 ./single-committer.sh OWNER/REPO ...        # apply
#
# Needs the GitHub CLI signed in as a repository admin. CICD_APP_ID is the
# numeric App ID from the app's settings page (not its installation id).
# Rulesets need a public repository, or GitHub Pro/Team for private ones.
set -euo pipefail

: "${CICD_APP_ID:?set CICD_APP_ID to the CI/CD agent GitHub App id}"
[ "$#" -gt 0 ] || { echo "usage: CICD_APP_ID=... $0 OWNER/REPO..." >&2; exit 2; }

single_committer=$(cat <<JSON
{
  "name": "single-committer",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": ${CICD_APP_ID}, "actor_type": "Integration", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "update" },
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
)

approval_required=$(cat <<JSON
{
  "name": "approval-required",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    }
  ]
}
JSON
)

apply() {
  local repo=$1 name=$2 body=$3 existing
  existing=$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name==\"$name\") | .id" 2>/dev/null || true)
  if [ -z "${APPLY:-}" ]; then
    echo "[dry run] $repo: would ${existing:+update ruleset $existing}${existing:-create ruleset} $name"
  elif [ -n "$existing" ]; then
    echo "$body" | gh api -X PUT "repos/$repo/rulesets/$existing" --input - >/dev/null
    echo "$repo: updated ruleset $name"
  else
    echo "$body" | gh api -X POST "repos/$repo/rulesets" --input - >/dev/null
    echo "$repo: created ruleset $name"
  fi
}

for repo in "$@"; do
  apply "$repo" single-committer "$single_committer"
  apply "$repo" approval-required "$approval_required"
done
