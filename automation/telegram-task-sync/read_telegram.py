#!/usr/bin/env python3
"""Read the last N hours of messages from a Telegram group and print them as JSON.

Used by the "telegram-task-sync" routine. This script ONLY reads messages and
prints them to stdout — it never sends, edits, or deletes anything, and it does
not talk to the backoffice. The reasoning ("is this a bug/request?", "does a task
already exist?") and task creation are done by the routine agent, not here.

Auth uses a Telethon StringSession (a logged-in *user* session, not a bot), which
is the only way to read a group's message history. Generate it once locally with
`generate_session.py`.

Required environment variables:
  TELEGRAM_API_ID     int    from https://my.telegram.org
  TELEGRAM_API_HASH   str    from https://my.telegram.org
  TELEGRAM_SESSION    str    StringSession produced by generate_session.py
  TELEGRAM_CHAT_ID    str    target chat id, e.g. -4643549576 (the id in the
                             web.telegram.org/k/#<id> URL)

Optional:
  TELEGRAM_WINDOW_HOURS  int  how far back to read (default 24)

Output (stdout): a JSON object
  {
    "chat_id": <int>,
    "chat_title": <str>,
    "window_hours": <int>,
    "since_utc": <iso8601>,
    "count": <int>,
    "messages": [
      {"message_id", "date", "sender", "text", "permalink"}, ...
    ]
  }
"""

import asyncio
import json
import os
import sys
from datetime import UTC, datetime, timedelta

from telethon import TelegramClient, utils
from telethon.sessions import StringSession


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.stderr.write(f"Missing required env var: {name}\n")
        sys.exit(2)
    return value


async def _resolve_entity(client: TelegramClient, target_id: int):
    """Find the chat entity matching ``target_id``.

    Telegram exposes a few id conventions (marked ids like -100... for channels
    and -... for basic groups, vs. the raw positive id). We try the most direct
    resolution first, then fall back to scanning dialogs and matching on either
    the marked id or the absolute raw id, so the configured value from the
    web URL works regardless of group type.
    """
    try:
        return await client.get_entity(target_id)
    except Exception:
        pass

    abs_id = abs(target_id)
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        try:
            marked = utils.get_peer_id(entity)
        except Exception:
            marked = None
        if marked == target_id or getattr(entity, "id", None) == abs_id:
            return entity

    sys.stderr.write(
        f"Could not find a chat with id {target_id} in this account's dialogs.\n"
        "Make sure the logged-in user is a member of the group.\n"
    )
    sys.exit(3)


def _permalink(entity, message_id: int) -> str | None:
    """Best-effort t.me permalink for a message."""
    username = getattr(entity, "username", None)
    if username:
        return f"https://t.me/{username}/{message_id}"
    # Private supergroups/channels expose an internal id usable as t.me/c/<id>/<msg>.
    internal = getattr(entity, "id", None)
    is_channel = entity.__class__.__name__ == "Channel"
    if is_channel and internal is not None:
        return f"https://t.me/c/{internal}/{message_id}"
    return None


async def main() -> None:
    api_id = int(_require_env("TELEGRAM_API_ID"))
    api_hash = _require_env("TELEGRAM_API_HASH")
    session = _require_env("TELEGRAM_SESSION")
    target_id = int(_require_env("TELEGRAM_CHAT_ID"))
    window_hours = int(os.environ.get("TELEGRAM_WINDOW_HOURS", "24"))

    since = datetime.now(UTC) - timedelta(hours=window_hours)

    client = TelegramClient(StringSession(session), api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            sys.stderr.write(
                "TELEGRAM_SESSION is not authorized. Regenerate it with "
                "generate_session.py.\n"
            )
            sys.exit(4)

        entity = await _resolve_entity(client, target_id)
        chat_title = getattr(entity, "title", None) or utils.get_display_name(entity)

        messages = []
        async for msg in client.iter_messages(entity):
            msg_date = msg.date  # tz-aware UTC
            if msg_date is None or msg_date < since:
                break  # iter_messages is newest-first; stop once we pass the window
            text = (msg.message or "").strip()
            if not text:
                continue  # skip media-only / service messages without text

            sender_name = None
            try:
                sender = await msg.get_sender()
                if sender is not None:
                    sender_name = utils.get_display_name(sender) or getattr(
                        sender, "username", None
                    )
            except Exception:
                sender_name = None

            messages.append(
                {
                    "message_id": msg.id,
                    "date": msg_date.isoformat(),
                    "sender": sender_name,
                    "text": text,
                    "permalink": _permalink(entity, msg.id),
                }
            )

        messages.reverse()  # chronological order (oldest first) for readability

        json.dump(
            {
                "chat_id": target_id,
                "chat_title": chat_title,
                "window_hours": window_hours,
                "since_utc": since.isoformat(),
                "count": len(messages),
                "messages": messages,
            },
            sys.stdout,
            ensure_ascii=False,
            indent=2,
        )
        sys.stdout.write("\n")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
