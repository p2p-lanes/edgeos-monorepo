# telegram-task-sync

A scheduled Claude Code **routine** that runs once a day and does two things, as a
**"Claude"** service user:

1. **Telegram → tasks:** reads the last 24 h of a Telegram group and creates backoffice
   tasks (`/tasks`) for any bug report or feature/change request that isn't already tracked.
2. **Task ↔ code reconciliation:** cross-references existing open tasks against the cloned
   repo and, when it finds clear evidence the work is already further along (merged to `dev`
   or shipped on `main`), leaves a `[reconcile]` comment and advances the task status.

```
Telegram group ──(read_telegram.py, Bot API getUpdates over HTTPS)──► messages (JSON)
                                                                   │
routine agent ── OTP login as Claude (code read via Gmail) ───────┤
              ── GET existing /tasks ──────────────────────────────┤
              ── classify + dedupe ──────────────────────────────► POST new /tasks
              ── git fetch dev/main + match tasks to code ────────► comment + PATCH status
```

## Why these choices
- **Bot API, not Telethon/MTProto:** the routine runs in Anthropic's cloud, whose egress
  proxy only allows HTTP(S) to allowlisted domains — MTProto (raw TCP to Telegram DC IPs) is
  impossible there. The Bot API is plain HTTPS to `api.telegram.org`, which works. Trade-off:
  the bot only sees messages from *after* it joins (no pre-join history); `getUpdates` retains
  ~24 h of updates, which matches the "last 24 h" daily window once the bot is in the group.
- **"Claude" service user:** the tasks API stamps `created_by` (a `users.id` FK) and resolves
  the display name from `users.full_name`. A superadmin user named "Claude" makes tasks show
  "Created by: Claude" with no schema change.
- **OTP via Gmail connector:** backoffice login is passwordless (6-digit code emailed). Rather
  than storing the backend's master `SECRET_KEY` (which lives in *unencrypted* routine env and
  could mint tokens for any user), the routine logs in as Claude and reads the code from the
  operator's inbox via the Gmail MCP connector. The Claude user's email is a plus-alias
  (`ignacio+claude@muvinai.com`) that Gmail delivers to `ignacio@muvinai.com`.

## Files
| File | Where it runs | Purpose |
|------|---------------|---------|
| `read_telegram.py` | in the routine | Fetch recent group messages via the Bot API (stdlib only, no deps) and print them as JSON. Read-only. |
| `create_claude_user.py` | **once, against the DB** | Idempotently create the Claude superadmin (kept for reference; the user was created via `POST /api/v1/users`). |
| `ROUTINE_PROMPT.md` | fetched by the routine | The detailed instructions the routine follows. |

---

## One-time setup

### 1. Create the "Claude" service user
Run once against the target database (with the backend's env loaded):
```bash
cd backend
python ../automation/telegram-task-sync/create_claude_user.py
```
Creates `ignacio+claude@muvinai.com` / full_name `Claude` / role `superadmin`.
(See the script header for the equivalent raw SQL if you'd rather run it on the DB directly.)

Verify it can log in (manual smoke test against prod):
```bash
curl -sX POST https://api.edgeos.world/api/v1/auth/user/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ignacio+claude@muvinai.com"}'
# → check ignacio@muvinai.com inbox for the code, then:
curl -sX POST https://api.edgeos.world/api/v1/auth/user/authenticate \
  -H 'Content-Type: application/json' \
  -d '{"email":"ignacio+claude@muvinai.com","code":"<CODE>"}'
# → returns {"access_token": "...", "token_type":"bearer"}
```

### 2. Create the Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → follow prompts → copy the **bot token**.
2. Disable privacy mode so the bot can read all group messages (not just @mentions):
   `/setprivacy` → pick the bot → **Disable**.
3. **Add the bot to the target group** (`web.telegram.org/k/#-4643549576`). It only sees
   messages sent *after* it joins.
4. Do NOT set a webhook on the bot — the reader uses `getUpdates`, which conflicts with webhooks.

The target group id is in the web URL `web.telegram.org/k/#-4643549576` → `-4643549576`.
(If the group is a supergroup, the Bot API id may be `-100…` instead — the reader logs the
chat ids it sees in `chats_seen` so you can correct `TELEGRAM_CHAT_ID`.)

### 3. Smoke-test the reader locally (no deps — stdlib only)
```bash
export TELEGRAM_BOT_TOKEN='123456:ABC...'
export TELEGRAM_CHAT_ID=-4643549576
python3 automation/telegram-task-sync/read_telegram.py | head -40
```
You should see recent messages as JSON (send a test message in the group first, since the
bot only captures messages from after it joined).

---

## Configure the routine (claude.ai/code → Routines)

- **Repository:** `edgeos-monorepo`. The routine fetches the scripts from the
  `feat/telegram-task-sync` branch at runtime (`git fetch origin feat/telegram-task-sync`),
  so they don't need to be on `main`.
- **Schedule:** daily, off-minute (e.g. cron `37 12 * * *` UTC). Minimum interval is 1 h.
- **Setup script:** none needed — the reader is stdlib-only (no `pip install`).
- **Connectors:** enable **Gmail** (to read the OTP).
- **Network access:** **Custom** allowing `api.edgeos.world` and `api.telegram.org`
  (`*.telegram.org` also covers it), with "include default package managers" checked.
- **Environment variables:**
  ```
  TELEGRAM_BOT_TOKEN=123456:ABC...
  TELEGRAM_CHAT_ID=-4643549576
  EDGEOS_API_BASE=https://api.edgeos.world
  CLAUDE_USER_EMAIL=ignacio+claude@muvinai.com
  ```
  Note: routine env vars are **not encrypted** and are visible to anyone who can edit the
  environment. The bot token can post/read as the bot — treat it as a secret. No backend
  `SECRET_KEY` is stored here by design.
- **Prompt:** a short bootstrap that fetches this branch and tells the agent to follow
  `ROUTINE_PROMPT.md` (see that file).

## Bot API notes & limitations
- The bot only sees messages from **after it joined** the group, and only if **privacy mode
  is OFF**. It cannot backfill older history.
- `getUpdates` retains updates for ~24 h; the reader advances the offset as it reads, so each
  daily run returns roughly the last 24 h. Boundary overlaps are harmless thanks to the
  `[tg:<message_id>]` dedupe marker.
- Only one `getUpdates` consumer can run, and no webhook may be set on the bot.

## How duplicates are avoided
Each created task embeds a `[tg:<message_id>]` marker (and the permalink) in its `detail`.
The routine skips any message whose id already appears in an existing task, so overlapping
24 h windows across daily runs don't recreate tasks. The agent also dedupes by subject.

## Task ↔ code reconciliation
For open tasks (`to_do` / `testing` / `next_release`), the routine fetches `origin/dev` and
`origin/main` and looks for concrete evidence (a matching merged commit/PR, or the described
behavior present in the code) that the work is already further along than the task's status.

Branch → status model (configurable in the prompt): merged to **`dev`** (integration, not yet
on `main`) → `next_release`; on **`main`** (production) → `published`.

When the match is unambiguous it adds a `[reconcile]` comment citing the evidence
(`POST /tasks/{id}/comments`) and advances the status (`PATCH /tasks/{id}/status`). Guards:
acts only on high confidence, never moves a status backward, never touches
`published`/`cancelled`/`blocked`, and skips a task that already has a matching `[reconcile]`
comment (so re-runs don't spam). It never edits files or pushes — its only writes are tasks,
comments, and status changes via the API.

## Security notes
- The `TELEGRAM_BOT_TOKEN` lets anyone act as the bot. Never commit it; revoke/rotate it via
  @BotFather (`/revoke`) if leaked.
- The Claude user is a real superadmin. Its access is gated by OTP delivery to the operator's
  inbox, so whoever controls that inbox controls the account.
