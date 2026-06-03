#!/usr/bin/env python3
"""One-time, interactive helper to produce a Telethon StringSession.

Run this LOCALLY (it requires entering your phone number and the login code
Telegram sends you). It is NOT run by the routine. The printed string goes into
the routine's TELEGRAM_SESSION environment variable.

Usage:
    export TELEGRAM_API_ID=...      # from https://my.telegram.org
    export TELEGRAM_API_HASH=...
    python generate_session.py

The session string grants full access to the logged-in account. Treat it like a
password: store it only as a routine secret, never commit it.
"""

import os
import sys

from telethon.sync import TelegramClient
from telethon.sessions import StringSession


def main() -> None:
    api_id = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        sys.stderr.write(
            "Set TELEGRAM_API_ID and TELEGRAM_API_HASH first "
            "(create them at https://my.telegram.org).\n"
        )
        sys.exit(2)

    with TelegramClient(StringSession(), int(api_id), api_hash) as client:
        session_string = client.session.save()
        print("\n=== TELEGRAM_SESSION (store as a routine secret) ===\n")
        print(session_string)
        print(
            "\nDone. Copy the line above into the routine's TELEGRAM_SESSION "
            "env var.\n"
        )


if __name__ == "__main__":
    main()
