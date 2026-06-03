# telegram-task-sync

A scheduled Claude Code **routine** that runs once a day and does two things, as a
**"Claude"** service user:

1. **Telegram → tasks:** reads the last 24 h of a Telegram group and creates backoffice
   tasks (`/tasks`) for any bug report or feature/change request that isn't already tracked.
2. **Task ↔ code reconciliation:** cross-references existing open tasks against the cloned
   repo and, when it finds clear evidence the work is already further along (merged to `dev`
   or shipped on `main`), leaves a `[reconcile]` comment and advances the task status.

```
Telegram group ──(read_telegram.py, MTProto user session)──► messages (JSON)
                                                                   │
routine agent ── OTP login as Claude (code read via Gmail) ───────┤
              ── GET existing /tasks ──────────────────────────────┤
              ── classify + dedupe ──────────────────────────────► POST new /tasks
              ── git fetch dev/main + match tasks to code ────────► comment + PATCH status
```

## Why these choices
- **MTProto user session (Telethon), not a bot:** a bot can't read a group's *history* — it
  only sees new messages after it joins, with privacy limits. Reading "the last 24 h" requires
  a logged-in user session.
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
| `read_telegram.py` | in the routine | Print last-N-hours messages as JSON. Read-only. |
| `generate_session.py` | **locally, once** | Interactive login → prints `TELEGRAM_SESSION`. |
| `create_claude_user.py` | **once, against the DB** | Idempotently create the Claude superadmin. |
| `ROUTINE_PROMPT.md` | — | The prompt to paste into the routine. |

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

### 2. Get Telegram API credentials + session string
1. Go to https://my.telegram.org → API development tools → create an app → copy `api_id`
   and `api_hash`.
2. Generate the session locally (interactive — needs your phone + the login code Telegram
   sends you):
   ```bash
   pip install -r automation/telegram-task-sync/requirements.txt
   export TELEGRAM_API_ID=...
   export TELEGRAM_API_HASH=...
   python automation/telegram-task-sync/generate_session.py
   ```
   Copy the printed `TELEGRAM_SESSION` string.
3. The logged-in account **must be a member** of the target group.

The target group id is in the web URL `web.telegram.org/k/#-4643549576` → `-4643549576`.

### 3. Smoke-test the reader locally
```bash
export TELEGRAM_API_ID=... TELEGRAM_API_HASH=... TELEGRAM_SESSION='...'
export TELEGRAM_CHAT_ID=-4643549576
python automation/telegram-task-sync/read_telegram.py | head -40
```
You should see recent messages as JSON.

---

## Configure the routine (claude.ai/code → Routines)

- **Repository:** `edgeos-monorepo`
- **Schedule:** daily, off-minute (e.g. cron `37 9 * * *`). Minimum interval is 1 h.
- **Setup script:** `pip install -r automation/telegram-task-sync/requirements.txt`
- **Connectors:** enable **Gmail** (to read the OTP).
- **Network access:** set to **Custom** and allow the backend host (`api.edgeos.world`) plus
  Telegram. ⚠️ See "MTProto egress" below — validate this before relying on it.
- **Environment variables (secrets):**
  ```
  TELEGRAM_API_ID=...
  TELEGRAM_API_HASH=...
  TELEGRAM_SESSION=...
  TELEGRAM_CHAT_ID=-4643549576
  EDGEOS_API_BASE=https://api.edgeos.world
  CLAUDE_USER_EMAIL=ignacio+claude@muvinai.com
  ```
  Note: routine env vars are **not encrypted** and are visible to anyone who can edit the
  environment. The session string and api_hash grant access to the Telegram account — treat
  accordingly. No backend `SECRET_KEY` is stored here by design.
- **Prompt:** paste the contents of `ROUTINE_PROMPT.md`.

## ⚠️ MTProto egress (validate first)
Telethon connects to Telegram's data-center **IPs** on :443 — it does **not** use
`api.telegram.org` (that's the Bot API). A domain/SNI-based egress allowlist may block these
direct-IP connections. Before trusting the daily run, do a **one-off run** of the routine that
only executes `read_telegram.py` and confirm it returns messages.

If MTProto is blocked in the sandbox, fallbacks (in order of preference):
1. Add Telegram's DC hosts/IP ranges to the allowlist if the config supports it.
2. Run `read_telegram.py` **locally** on a schedule and have the routine consume its output.
3. Switch to the Telegram **Bot API** — but it only sees messages *after* the bot joins (no
   history), which degrades the "last 24 h" requirement.

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
- The `TELEGRAM_SESSION` is equivalent to being logged into that Telegram account. Never
  commit it; rotate it (re-run `generate_session.py` and log out old sessions) if leaked.
- The Claude user is a real superadmin. Its access is gated by OTP delivery to the operator's
  inbox, so whoever controls that inbox controls the account.
