"""Entrypoint for the automatic reminder dispatcher job.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule -> ECS RunTask, systemd timer, or plain crontab).

Usage:
    uv run python -m app.jobs.reminder_dispatch

Exit codes:
    0 — dispatch completed (possibly a no-op when no popup has a reminder
        configured or the advisory lock was held by a concurrent instance)
    1 — dispatch completed but at least one send/popup raised an error;
        check logs for detail

Recommended interval: once per day. Delays are configured per popup in days,
so a daily run is enough; the email_logs history makes reruns idempotent.
Whether a reminder is sent at all is decided entirely by per-popup config
(clearing a reminder's delay disables it), so there is no global on/off flag.
"""

import asyncio
import sys

from loguru import logger
from sqlmodel import Session

from app.core.db import engine
from app.services.reminder_dispatch import dispatch_reminders


def main() -> int:
    with Session(engine) as db:
        summary = asyncio.run(dispatch_reminders(db))

    logger.info("reminder_dispatch: job finished summary={}", summary)
    return 1 if summary.get("failed") else 0


if __name__ == "__main__":
    sys.exit(main())
