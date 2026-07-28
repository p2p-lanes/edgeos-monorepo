"""Entrypoint for the trial expiration job.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule -> ECS RunTask, systemd timer, plain crontab).

Usage:
    uv run python -m app.jobs.trial_expiration

Exit codes:
    0 — run completed (possibly a no-op when no trial is due)
    1 — run completed but at least one tenant failed; check logs

Recommended interval: hourly.
"""

import asyncio
import sys

from loguru import logger
from sqlmodel import Session

from app.core.db import engine
from app.services.trial_expiration import sweep_trial_expirations


def main() -> int:
    with Session(engine) as db:
        summary = asyncio.run(sweep_trial_expirations(db))
    logger.info("Trial expiration sweep finished: {}", summary)
    return 1 if summary.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
