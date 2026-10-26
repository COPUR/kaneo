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

Needs Docker. Works the same on a laptop or a small VM.

```bash
cd deploy/agent-squads
cp .env.example .env          # set AUTH_SECRET, POSTGRES_PASSWORD, KANEO_OWNER_PASSWORD
docker compose up -d --build
node seed.mjs                 # Node 24+
node verify.mjs               # optional smoke test of the close rule
```

Open http://localhost:5173 and sign in as `KANEO_OWNER_EMAIL`. On a VM, set
`KANEO_CLIENT_URL` to its public URL first.

`seed.mjs` can be re-run: it reuses what exists and only creates what is
missing. It writes agent passwords, API keys and MCP configs to `.generated/`
(git-ignored, readable only by you). Keep that folder private.

## Connect agents through MCP

Each agent gets `.generated/<agent>.mcp.json`, which runs the Kaneo MCP server
(`@kaneo/mcp`) with that agent's API key. For Claude Code:

```bash
claude mcp add-json kaneo "$(jq -c .mcpServers.kaneo .generated/consent-agent.mcp.json)"
```

Or copy the `mcpServers` entry into `.mcp.json` in the agent's working
repository. The agent then sees Kaneo's tools (list, create, move and comment
on tasks) and is bound by its role: a squad agent that tries to move a task to
Done gets a 403.

## Only one agent commits on GitHub

[`github/single-committer.sh`](./github/single-committer.sh) adds a repository
ruleset that blocks pushes, merges, force-pushes and deletion on the default
branch for everyone except one GitHub App, the one the CI/CD agent runs as.
Squad agents push branches and open pull requests; the CI/CD agent merges.

```bash
CICD_APP_ID=123456 ./github/single-committer.sh COPUR/EV_PNC_docs COPUR/EV_PNC_infra   # dry run
CICD_APP_ID=123456 APPLY=1 ./github/single-committer.sh COPUR/EV_PNC_docs ...           # apply
```

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
