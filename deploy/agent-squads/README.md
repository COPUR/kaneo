# Kaneo for agent squads

A Kaneo setup for a tribe of AI agent squads, organised like the Spotify model:
one tribe workspace, one board per squad, chapters and guilds as labels, and a
tribe Decisions board. Squad agents pick up and move work. **Only the CI/CD
agent can close it**, in Kaneo and on GitHub.

## What you get

| Piece | In Kaneo |
| --- | --- |
| Tribe | Workspace `EV PnC Tribe` |
| Squads | Boards NAV, CON, ROA, TEL, PLT, INV, PAY, SEC (navigation, consent, roaming, telemetry, platform, invoicing, payments, security) |
| Squad flow | Backlog → In Progress → Decision Needed → In Review → Done (final) |
| Decisions | Board DEC: Proposed → In Discussion → Ready for PO → Accepted or Rejected (both final) |
| Chapters and guilds | Labels `chapter:*`, `guild:*`, plus `decision`, `adr`, `blocked`, `needs-human` |
| Task fields | Decision, Pull request, Agent status (squads); ADR, Squads affected, Decided on (DEC) |
| Squad agents | One account per squad, role `member`, with its own API key |
| CI/CD agent | One account, custom role `cicd-agent` with `task:close`, access to the squad boards only |
| Product owner | The first account: workspace owner and instance admin |

Edit [`squads.mjs`](./squads.mjs) to change squads, columns, fields or labels.

## Who can close work

This fork adds a `task:close` permission. With `KANEO_RESTRICT_FINAL_COLUMNS=true`
(set in `compose.yml`), moving a task into a final column needs it. That covers
the status, update, move, reorder, bulk and import routes, and so the board,
the MCP tools and API keys. Without the variable Kaneo behaves as upstream.

| Role | Moves work | Closes squad work | Settles decisions |
| --- | --- | --- | --- |
| Squad agent (`member`) | yes | no | no |
| CI/CD agent (`cicd-agent`) | yes | yes | no (no access to DEC) |
| Product owner (`owner`) | yes | yes | yes |

New workspaces give `admin` the permission too. Workspaces created before this
fork keep their stored `admin` role; add **Close** to it under Settings → Roles
if admins should close work.

Tasks closed by the GitHub, GitLab or Gitea integrations (for example when a
merged pull request moves a task to Done) are not affected. On GitHub only the
CI/CD agent can merge, so that path still belongs to it.

## Run it

Needs Docker and Node 24+. Works the same on a laptop or a small VM. Clone
`EV_PNC_docs` next to this repository for the backlog, then:

```bash
cd deploy/agent-squads
./setup.sh
```

`setup.sh` stops at the first failing step and can be re-run. It runs, in order:

1. `node init-env.mjs`: creates `.env` and fills `AUTH_SECRET`,
   `POSTGRES_PASSWORD` and `KANEO_OWNER_PASSWORD` when empty. Set values are kept.
2. `docker compose up -d --build`
3. `node seed.mjs`: tribe, squads, agents, API keys and MCP configs (waits for the API).
4. `node verify.mjs`: smoke test of the close rule.
5. `node backlog.mjs <EV_PNC_docs kanban CSVs>`: pass another `EV_PNC_docs`
   path as `./setup.sh path/to/EV_PNC_docs`.
6. `node kickoff.mjs`: each squad agent pulls its first card.
7. `docker compose -f compose.yml -f .generated/compose.mcp.yml up -d`: agent MCP ports.

Open http://localhost:5173 and sign in as `KANEO_OWNER_EMAIL` with
`KANEO_OWNER_PASSWORD` from `.env`. On a VM, set
`KANEO_CLIENT_URL` to its public URL first.

`seed.mjs` can be re-run: it reuses what exists and only creates what is
missing. It writes agent passwords, API keys and MCP configs to `.generated/`
(git-ignored, readable only by you). Keep that folder private.

## Ports

| What | Address | Who |
| --- | --- | --- |
| Web app | http://localhost:5173 | Product owner (people) |
| REST API | http://localhost:5173/api | Scripts, `x-api-key: <agent key>` |
| CI/CD agent MCP | http://localhost:7100/mcp | Only agent that closes work |
| Squad agent MCP | http://localhost:7101/mcp to 7108/mcp | NAV, CON, ROA, TEL, PLT, INV, PAY, SEC in that order |

Each MCP port acts as one agent, so the ports are published on `127.0.0.1`
only. Set `KANEO_MCP_BASE_PORT` before `seed.mjs` to move the range.

## Backlog and iterations

The squads work agile: small batches, pull instead of push, one card in
progress per squad, and the product owner deciding on DEC.

- [`repos.mjs`](./repos.mjs) says which squad owns which EV PnC repository.
  Platform owns docs, infra, infra-modules and the simulator; Roaming the OCPI
  and hub repositories; Telemetry telemetry and pilot analytics; Consent the
  `EV_PnC_Consent_*` family. Navigation, Invoicing and Payments get theirs from
  backlog cards.
- [`backlog.mjs`](./backlog.mjs) loads CSVs in the `EV_PNC_docs` kanban shape
  onto the owning squad's board, product-owner gates onto DEC, `Depends on`
  as "blocks" relations, and a walking-skeleton card for every repository.
  `CURRENT_ITERATION` (default `I3`) makes that iteration's cards high
  priority, the next one medium and later ones low.
- [`kickoff.mjs`](./kickoff.mjs) has each squad agent, with its own key, pull
  the most urgent unblocked card into In Progress and set **Agent status** to
  Claimed. A squad that already has a card in progress keeps it.

## Let the squads work on their own

[`run-squads.sh`](./run-squads.sh) starts one headless Claude Code agent per
squad and the CI/CD agent, in the background, with a log each. Needs the
`claude` CLI (signed in), `gh` (signed in as an account that can push to the
EV PnC repositories) and Kaneo running from `setup.sh`.

```bash
./run-squads.sh            # all squads and the CI/CD agent
./run-squads.sh CON TEL    # only these squads (and the CI/CD agent)
./run-squads.sh status     # who is running, last log line each
./run-squads.sh logs CON   # follow one log (.runner/logs/<KEY>.log)
./run-squads.sh stop       # stop every agent now
```

Each squad agent ([`runner/squad.mjs`](./runner/squad.mjs)) loops:

1. Takes its card in progress, or claims the most urgent unblocked Backlog
   card (WIP 1, the same rule as `kickoff.mjs`).
2. Clones the card's repository (`**Repository:**` in the card, else the
   squad's first repository from `repos.mjs`) next to this checkout, and adds a
   worktree for the card under `.squad-worktrees/<KEY>/`.
3. Runs `claude -p` there with the squad's system prompt
   ([`runner/prompt.mjs`](./runner/prompt.mjs)) and its own MCP port, so it
   acts on Kaneo as that squad's agent. It may edit, test and commit, but not
   push, use `gh` or merge.
4. With commits, the runner pushes the branch, opens the pull request, fills
   **Pull request**, moves the card to In Review and sets **Agent status** to
   Handed to CI/CD. A decision the squad cannot take goes to DEC and the card to
   Decision Needed. A session without commits, or one that fails, also moves
   the card to Decision Needed, so a person looks.

The CI/CD agent ([`runner/cicd.mjs`](./runner/cicd.mjs)) checks In Review on
every squad board. It merges (squash, pinned to the head commit) and moves the
card to Done only when the pull request is open and not a draft, checks are
green, it is mergeable, no review asks for changes or an approval is still
required, and the approver agent's rules pass. When the rules leave it to a
person, it labels the pull request `needs-human` and waits; approving it on
GitHub and removing the label lets it merge. The approver workflow is
unchanged.

Caps, in `.env` or the environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SQUAD_MAX_CARDS` | 5 | Cards each squad agent finishes before it stops |
| `SQUAD_RUN_BUDGET_USD` | 5 | `claude --max-budget-usd` for one card |
| `SQUAD_TOTAL_BUDGET_USD` | 25 | Spend per squad agent before it stops |
| `SQUAD_RUN_TIMEOUT_MIN` | 45 | A session running longer is stopped |
| `SQUAD_IDLE_SECONDS` | 300 | Wait before looking at an empty Backlog again |
| `CICD_INTERVAL_SECONDS` | 120 | How often the CI/CD agent looks at In Review |
| `CICD_MAX_MERGES` | 40 | Merges before the CI/CD agent stops |
| `SQUAD_REPOS_DIR` | the folder holding this checkout | Where repositories are cloned |
| `SQUAD_MODEL` | Claude Code's default | `claude --model` for the squads |

All agents share the `gh` account of the machine, so on GitHub the "only the
CI/CD agent merges" rule is kept by the runners (squad sessions cannot run
`gh` or `git push`). Apply `github/single-committer.sh` to have GitHub enforce
it too.

## Connect agents through MCP

Each agent gets two configs in `.generated/`:

- `<agent>.mcp-http.json` points at the agent's MCP port (see Ports). For
  Claude Code: `claude mcp add --transport http kaneo http://localhost:7102/mcp`.
- `<agent>.mcp.json` starts the Kaneo MCP server (`@kaneo/mcp`) over stdio
  with that agent's API key, for clients without HTTP support:

```bash
claude mcp add-json kaneo "$(jq -c .mcpServers.kaneo .generated/consent-agent.mcp.json)"
```

Or copy the `mcpServers` entry into `.mcp.json` in the agent's working
repository. The agent then sees Kaneo's tools (list, create, move and comment
on tasks) and is bound by its role: a squad agent that tries to move a task to
Done gets a 403.

## Only one agent commits on GitHub

[`github/single-committer.sh`](./github/single-committer.sh) adds two repository
rulesets. `single-committer` blocks pushes, merges, force-pushes and deletion on the default
branch for everyone except one GitHub App, the one the CI/CD agent runs as.
Squad agents push branches and open pull requests; the CI/CD agent merges.
`approval-required` has no bypass and needs one approval on every pull request,
so the CI/CD agent can only merge what the approver agent (or a person) approved.

```bash
CICD_APP_ID=123456 ./github/single-committer.sh COPUR/EV_PNC_docs COPUR/EV_PNC_infra   # dry run
CICD_APP_ID=123456 APPLY=1 ./github/single-committer.sh COPUR/EV_PNC_docs ...           # apply
```

## The approver agent approves, the CI/CD agent merges

[`.github/workflows/agent-approver.yml`](../../.github/workflows/agent-approver.yml)
is a second agent with its own identity. On every pull request it:

1. Runs lint, typecheck, unit tests, and the i18n and OpenAPI checks.
2. Runs the code analysis gate ([`scripts/agent-approver/rules.mjs`](../../scripts/agent-approver/rules.mjs)):
   size limit (1500 changed lines), a secrets scan of added lines, and a
   needs-a-person list (pipelines, the gate itself, auth, schema and migrations).
   It also notes authorization changes, source changes without tests, and
   hotspots (files changed often in the last 90 days).
3. Approves when both pass, and the CI/CD agent then merges the reviewed commit
   (squash, pinned to that commit). Otherwise it comments, labels the pull
   request `needs-human`, or requests changes when checks fail.

Give each agent its own GitHub App so their actions are told apart:

| Agent | Repository variable | Secret | App permissions |
| --- | --- | --- | --- |
| Approver | `APPROVER_APP_ID` | `APPROVER_APP_PRIVATE_KEY` | Pull requests: write |
| CI/CD | `CICD_APP_ID` | `CICD_APP_PRIVATE_KEY` | Contents and pull requests: write |

Without them the workflow falls back to `GITHUB_TOKEN`, which can approve only
if Settings → Actions → General allows GitHub Actions to approve pull requests.
Draft pull requests and pull requests from forks are checked but not approved.

## Working agreement

1. Work starts in a squad's Backlog. The squad agent assigns itself and sets
   **Agent status** to Claimed, then Working.
2. A question the squad cannot settle goes to **Decision Needed** with the
   `decision` label, and a card on DEC that links back to it.
3. The product owner settles DEC cards (Accepted or Rejected) and records the
   ADR id in the **ADR** field. The squad card gets the same id in **Decision**.
4. The squad agent opens a pull request, puts its link in **Pull request**,
   moves the card to In Review and sets **Agent status** to Handed to CI/CD.
5. The CI/CD agent runs the checks, merges, and moves the card to Done.
