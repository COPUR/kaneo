#!/usr/bin/env bash
# Lets only the CI/CD agent change each repository's default branch.
#
# Creates (or updates) a repository ruleset named "single-committer" that
# blocks pushes, merges, force-pushes and deletion on the default branch for
# everyone except one GitHub App: the app the CI/CD agent runs as. Squad agents
# still push their own branches and open pull requests; the CI/CD agent merges.
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

ruleset=$(cat <<JSON
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

for repo in "$@"; do
  existing=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name=="single-committer") | .id' 2>/dev/null || true)
  if [ -z "${APPLY:-}" ]; then
    echo "[dry run] $repo: would ${existing:+update ruleset $existing}${existing:-create ruleset} single-committer (bypass: app $CICD_APP_ID)"
    continue
  fi
  if [ -n "$existing" ]; then
    echo "$ruleset" | gh api -X PUT "repos/$repo/rulesets/$existing" --input - >/dev/null
    echo "$repo: updated ruleset $existing"
  else
    echo "$ruleset" | gh api -X POST "repos/$repo/rulesets" --input - >/dev/null
    echo "$repo: created ruleset single-committer"
  fi
done
