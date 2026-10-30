# Slack listener agent

Listens to Slack and files requests as Kaneo cards. It runs next to Kaneo on
your machine and connects to Slack with Socket Mode, so it needs no public URL.

- Mention `@kaneo`, send it a direct message, or post in a channel listed in
  `SLACK_CARD_CHANNELS`: the message becomes a card and the bot replies in the
  thread with its link.
- Replies in that thread become comments on the card. `status` (or `durum`)
  answers with the card's column, `help` with the usage.
- It acts as its own Kaneo agent, `slack-agent`, a plain member. It can create
  and comment, but never move a card to Done: only the CI/CD agent closes work.

## Where a card goes

First match wins ([`route.mjs`](./route.mjs)):

1. A board key at the start: `CON: add revoke endpoint` or `[TEL] ...`
   (NAV CON ROA TEL PLT INV PAY SEC DEC).
2. Decision words (decision, decide, karar, ADR): DEC, column Proposed. Only
   the product owner settles it.
3. A repository name from [`repos.mjs`](../repos.mjs): that squad's board, and
   `**Repository:**` in the card so the squad runner works in that repository.
4. A squad name (consent, telemetry, ...): that squad's board.
5. The channel's board from `SLACK_CHANNEL_BOARDS`, else `SLACK_DEFAULT_BOARD`
   (PLT).

Squad cards land in Backlog. `urgent` or `acil` makes a card urgent, `high`,
`önemli` or `yüksek` high, everything else medium. The first line is the title.

## Set it up

1. Create the app: https://api.slack.com/apps → **Create New App** → **From a
   manifest** → pick your workspace → paste [`manifest.yml`](./manifest.yml) →
   **Create**.
2. **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**,
   name it `socket`, add the scope `connections:write`, **Generate**. Copy the
   `xapp-...` token.
3. **Install App** → **Install to Workspace** → **Allow**. Copy the **Bot User
   OAuth Token** (`xoxb-...`).
4. Put both in `deploy/agent-squads/.env` (git-ignored, never commit them):

   ```bash
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```

5. Create the agent account and start the listener:

   ```bash
   cd deploy/agent-squads
   node seed.mjs                                    # adds slack-agent
   docker compose --profile slack up -d slack-listener
   docker compose logs -f slack-listener            # "connected to Slack"
   ```

   Or without Docker: `node slack/listener.mjs`. `./setup.sh` starts it too
   once `SLACK_APP_TOKEN` is in `.env`.

6. In Slack, invite it to a channel (`/invite @kaneo`) and write
   `@kaneo CON: consent revoke returns 500`.

To turn every message of a channel into a card, put the channel id
(channel name → **View channel details**, at the bottom) in
`SLACK_CARD_CHANNELS`, comma separated, and restart the listener. Give a
channel its own board with `SLACK_CHANNEL_BOARDS=C0123=CON,C0456=TEL`.

## Settings

| Variable               | Default                      | Meaning                                                  |
| ---------------------- | ---------------------------- | -------------------------------------------------------- |
| `SLACK_BOT_TOKEN`      |                              | Bot token, `xoxb-...`                                    |
| `SLACK_APP_TOKEN`      |                              | App-level token with `connections:write`, `xapp-...`     |
| `SLACK_DEFAULT_BOARD`  | `PLT`                        | Board when nothing else matches                          |
| `SLACK_CARD_CHANNELS`  |                              | Channel ids where every top-level message becomes a card |
| `SLACK_CHANNEL_BOARDS` |                              | `channel=BOARD` pairs                                    |
| `SLACK_STATE_FILE`     | `.runner/slack-threads.json` | Which thread belongs to which card                       |

Stop it with `docker compose --profile slack stop slack-listener`. To remove
its access, delete the `slack-agent` API key in Kaneo or the app in Slack.
