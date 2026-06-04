#!/usr/bin/env python3
"""Read recent messages from one or more Telegram groups via the Bot API as JSON.

Used by the "telegram-task-sync" routine. This script ONLY reads messages and prints
them to stdout — it never sends, edits, or deletes anything, and it does not talk to the
backoffice.

Why the Bot API (and not Telethon/MTProto): the routine runs in Anthropic's cloud, whose
egress proxy only allows HTTP(S) to allowlisted domains. MTProto (raw TCP to Telegram DC
IPs) is impossible there. The Bot API is plain HTTPS to `api.telegram.org`, which works.

A single bot can sit in many groups: `getUpdates` returns the messages from every group it
is a member of, and this script keeps the ones whose chat id is in TELEGRAM_CHAT_ID (a
comma-separated allowlist). Each message carries its `chat_id` / `chat_title` so the routine
can attribute the source group and scope its dedupe marker per chat.

Consequences of the Bot API:
- The bot only sees messages while it is a member of the group AND privacy mode is OFF
  (set via BotFather: /setprivacy -> Disable). It cannot read history from before it joined.
- `getUpdates` retains updates for ~24h. This script advances the offset as it reads, so a
  daily run yields roughly the last 24h of messages. Overlaps across runs are harmless
  because tasks carry a [tg:<chat_id>:<message_id>] dedupe marker.
- The bot must NOT have a webhook set (getUpdates and webhooks are mutually exclusive).

Required environment variables:
  TELEGRAM_BOT_TOKEN   str   bot token from BotFather

Optional:
  TELEGRAM_CHAT_ID       str   comma-separated allowlist of chat ids to keep
                               (e.g. "-4643549576,-1001234567890"). A single id works too.
                               If unset/empty, returns messages from every chat the bot sees.
  TELEGRAM_WINDOW_HOURS  int   how far back to keep messages (default 24)

Forum supergroups (groups with "Topics" on) share ONE chat id across all their topics; each
message carries a `message_thread_id` that identifies its topic. This script surfaces that id
plus a best-effort `topic_name`. The name only travels in a `forum_topic_created/edited`
service message (usually sent long before the bot joined), so `topic_name` is filled only when
that service message falls inside the window; the forum's "General" topic is labelled as such.

Output (stdout): a JSON object
  {"chat_ids", "window_hours", "since_utc", "count", "messages": [...], "chats_seen": {...},
   "topics_seen": {...}}
where each message is {message_id, chat_id, chat_title, message_thread_id, topic_name, date,
sender, text, permalink, reply_to}. `reply_to` is the quoted original when the message is a
reply (id/date/sender/text), even if that original was sent before the bot joined; null
otherwise.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta

API_BASE = "https://api.telegram.org"
MAX_PAGES = 20  # safety cap: up to 20 * 100 = 2000 messages per run


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.stderr.write(f"Missing required env var: {name}\n")
        sys.exit(2)
    return value


def _call(token: str, method: str, params: dict) -> object:
    url = f"{API_BASE}/bot{token}/{method}?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        sys.stderr.write(f"Telegram API HTTP {e.code} on {method}: {body}\n")
        sys.exit(3)
    except urllib.error.URLError as e:
        sys.stderr.write(f"Cannot reach Telegram API ({method}): {e}\n")
        sys.exit(3)
    if not payload.get("ok"):
        sys.stderr.write(f"Telegram API error on {method}: {payload}\n")
        sys.exit(3)
    return payload["result"]


def _permalink(chat: dict, message_id: int) -> str | None:
    """Best-effort t.me permalink for a message."""
    username = chat.get("username")
    if username:
        return f"https://t.me/{username}/{message_id}"
    chat_id = chat.get("id")
    if chat.get("type") == "supergroup" and isinstance(chat_id, int):
        sid = str(chat_id)
        if sid.startswith("-100"):
            return f"https://t.me/c/{sid[4:]}/{message_id}"
    return None


def _sender_name(frm: dict) -> str | None:
    return (
        " ".join(p for p in (frm.get("first_name"), frm.get("last_name")) if p)
        or frm.get("username")
        or None
    )


def _msg_summary(m: dict | None) -> dict | None:
    """Compact view of a (possibly replied-to) message: id, date, sender, text."""
    if not m:
        return None
    text = (m.get("text") or m.get("caption") or "").strip()
    return {
        "message_id": m.get("message_id"),
        "date": (
            datetime.fromtimestamp(m["date"], UTC).isoformat() if m.get("date") else None
        ),
        "sender": _sender_name(m.get("from", {})),
        "text": text or None,
    }


def _parse_chat_filter(raw: str | None) -> set[int] | None:
    """Parse TELEGRAM_CHAT_ID into a set of ids, or None for "every chat".

    Accepts a single id ("-4643549576") or a comma-separated allowlist
    ("-4643549576, -1001234567890"). Empty/unset → None (no filtering).
    """
    if not raw or not raw.strip():
        return None
    ids: set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.add(int(part))
        except ValueError:
            sys.stderr.write(f"Ignoring non-numeric TELEGRAM_CHAT_ID entry: {part!r}\n")
    return ids or None


def main() -> None:
    token = _require_env("TELEGRAM_BOT_TOKEN")
    chat_filter = _parse_chat_filter(os.environ.get("TELEGRAM_CHAT_ID"))
    window_hours = int(os.environ.get("TELEGRAM_WINDOW_HOURS", "24"))

    since = datetime.now(UTC) - timedelta(hours=window_hours)
    since_ts = since.timestamp()

    messages: list[dict] = []
    chats_seen: dict[int, str] = {}
    # Forum topic names, keyed by (chat_id, thread_id), harvested from the rare
    # forum_topic_created/edited service messages that fall inside the window.
    topic_names: dict[tuple[int, int], str] = {}
    forum_chats: set[int] = set()  # chat ids whose chat.is_forum is true
    offset: int | None = None

    for _ in range(MAX_PAGES):
        params: dict = {
            "timeout": 0,
            "limit": 100,
            "allowed_updates": json.dumps(["message", "channel_post"]),
        }
        if offset is not None:
            params["offset"] = offset
        updates = _call(token, "getUpdates", params)
        if not updates:
            break
        for up in updates:
            offset = up["update_id"] + 1
            msg = up.get("message") or up.get("channel_post")
            if not msg:
                continue
            chat = msg.get("chat", {})
            cid = chat.get("id")
            chat_title = (
                chat.get("title") or chat.get("username") or chat.get("type") or ""
            )
            if cid is not None:
                chats_seen[cid] = chat_title
                if chat.get("is_forum"):
                    forum_chats.add(cid)
            if chat_filter is not None and cid not in chat_filter:
                continue
            # Forum topic name only ships in a topic-created/edited service message; when one
            # lands in the window, remember it. Its message_thread_id (or own message_id) is
            # the thread id all the topic's messages carry. Do this BEFORE the text filter —
            # service messages have no text and would otherwise be dropped here.
            ft = msg.get("forum_topic_created") or msg.get("forum_topic_edited")
            if ft and ft.get("name") and cid is not None:
                tid = msg.get("message_thread_id") or msg.get("message_id")
                topic_names[(cid, tid)] = ft["name"]
            if msg.get("date", 0) < since_ts:
                continue
            text = (msg.get("text") or msg.get("caption") or "").strip()
            if not text:
                continue
            messages.append(
                {
                    "message_id": msg["message_id"],
                    "chat_id": cid,
                    "chat_title": chat_title,
                    # Forum topic this message belongs to (None outside forums / General topic);
                    # topic_name is filled best-effort after the loop.
                    "message_thread_id": msg.get("message_thread_id"),
                    "topic_name": None,
                    "date": datetime.fromtimestamp(msg["date"], UTC).isoformat(),
                    "sender": _sender_name(msg.get("from", {})),
                    "text": text,
                    "permalink": _permalink(chat, msg["message_id"]),
                    # When this message replies to another (even one sent before the
                    # bot joined the group), Telegram includes the quoted original
                    # here — useful context for triage. None if not a reply.
                    "reply_to": _msg_summary(msg.get("reply_to_message")),
                }
            )

    # Attribute each message to its forum topic. The name is whatever we harvested from a
    # topic-created/edited service message in the window; for a forum's General topic
    # (no thread id) we label it explicitly; otherwise the name stays None (the thread id
    # still distinguishes topics, just without a human label).
    for m in messages:
        tid = m["message_thread_id"]
        if tid is not None:
            m["topic_name"] = topic_names.get((m["chat_id"], tid))
        elif m["chat_id"] in forum_chats:
            m["topic_name"] = "General"

    # Chronological across all chats (oldest first); message_id is per-chat, so tie-break on it.
    messages.sort(key=lambda m: (m["date"], m["chat_id"] or 0, m["message_id"]))

    if chat_filter is not None and not messages and chats_seen:
        sys.stderr.write(
            f"No messages matched TELEGRAM_CHAT_ID={sorted(chat_filter)}. "
            f"Chats the bot currently sees: {chats_seen}. "
            "If a target group is a supergroup, its id may differ (e.g. -100...); "
            "update TELEGRAM_CHAT_ID accordingly.\n"
        )

    # Nested {chat_id: {thread_id: name}} for the topic names we managed to harvest.
    topics_seen: dict[int, dict[int, str]] = {}
    for (cid, tid), name in topic_names.items():
        topics_seen.setdefault(cid, {})[tid] = name

    json.dump(
        {
            "chat_ids": sorted(chat_filter) if chat_filter is not None else None,
            "window_hours": window_hours,
            "since_utc": since.isoformat(),
            "count": len(messages),
            "messages": messages,
            "chats_seen": chats_seen,
            "topics_seen": topics_seen,
        },
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
