"""Entrypoint for the check-in pass dispatch job.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule → ECS RunTask, systemd timer, GitHub Actions cron, plain crontab —
anything that can run a container or Python module on an interval).

Usage:
    uv run python -m app.jobs.checkin_pass_dispatch

Exit codes:
    0 — dispatch completed (possibly a no-op when no popup is in the window)
    1 — dispatch completed but at least one buyer failed; check logs for detail

Recommended interval: hourly. See ``docs/scheduled-jobs.md`` for setup
examples per scheduler.
"""

import asyncio
import sys

from loguru import logger
from sqlmodel import Session

from app.core.db import engine
from app.services.checkin_pass_dispatch import dispatch_checkin_passes


def main() -> int:
    with Session(engine) as db:
        summary = asyncio.run(dispatch_checkin_passes(db))
    logger.info("Check-in pass dispatch finished: {}", summary)
    return 1 if summary.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
