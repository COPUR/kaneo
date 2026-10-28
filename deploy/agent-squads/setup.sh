#!/usr/bin/env bash
# One command from a fresh clone to a running tribe:
#
#   ./setup.sh [path/to/EV_PNC_docs]
#
# Fills .env, starts Kaneo, seeds squads and agents, checks the close rule,
# loads the backlog, lets each squad agent pull a card and starts the agent
# MCP ports. Stops at the first failing step. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")"
docs_dir="${1:-../../../EV_PNC_docs}"

step() { printf '\n==> %s\n' "$*"; }

for tool in docker node; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 24 ]; then
  echo "Node 24 or later is required (found $(node -v))" >&2
  exit 1
fi

step "Secrets in .env"
node init-env.mjs

step "Start Kaneo (first build takes a few minutes; do not sign up in the browser yet)"
docker compose up -d --build

owner_email="$(sed -n 's/^KANEO_OWNER_EMAIL=//p' .env)"

step "Make $owner_email an instance admin if the account already exists"
# Seeding creates agent accounts, which needs instance admin. Kaneo makes the
# first account admin; this covers an owner who signed up after someone else.
node --input-type=module -e 'import { loadEnv, waitForApi } from "./lib.mjs"; loadEnv(".env"); await waitForApi();'
docker compose exec -T postgres psql -q -U kaneo -d kaneo -v ON_ERROR_STOP=1 -v email="$owner_email" <<'SQL'
UPDATE "user" SET role = 'admin'
WHERE email = :'email'
  AND NOT ('admin' = ANY (string_to_array(coalesce(role, ''), ',')));
SQL

step "Seed tribe, squads and agents"
node seed.mjs

step "Check that only the CI/CD agent can close work"
node verify.mjs

kanban_dir="$docs_dir/docs/architecture/kafka-backend/kanban"
if compgen -G "$kanban_dir/*.csv" >/dev/null; then
  step "Load the backlog from $kanban_dir"
  node backlog.mjs "$kanban_dir"/*.csv
else
  step "No kanban CSV in $kanban_dir: loading walking skeletons only"
  node backlog.mjs
fi

step "Squad agents pull their first card"
node kickoff.mjs

step "Start the agent MCP ports"
docker compose -f compose.yml -f .generated/compose.mcp.yml up -d

owner_password="$(sed -n 's/^KANEO_OWNER_PASSWORD=//p' .env)"
cat <<EOF

Done.
  Web:       http://localhost:5173
  Sign in:   $owner_email / $owner_password  (also in deploy/agent-squads/.env)
  MCP ports: http://localhost:7100/mcp (CI/CD) and 7101-7108 (NAV CON ROA TEL PLT INV PAY SEC)
  Squads on their own: ./run-squads.sh   (stop: ./run-squads.sh stop)
EOF
