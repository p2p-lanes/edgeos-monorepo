"""Entrypoint for the pending payment sweeper job.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule → ECS RunTask, systemd timer, or plain crontab — anything that can
run a container or Python module on an interval).

Usage:
    uv run python -m app.jobs.pending_payment_sweeper

Exit codes:
    0 — sweep completed (possibly a no-op when PENDING_SWEEP_ENABLED=false
        or the advisory lock was held by a concurrent instance)
    1 — sweep completed but at least one candidate raised an unexpected error;
        check logs for detail

Recommended interval: every 5 minutes.  The staleness threshold defaults to
20 minutes (``PENDING_SWEEP_STALE_MINUTES``), so two to three runs see a
candidate before the provider's own expiry window closes.

Design reference: ADR-5 (pending-payment-hold-release).
"""

import asyncio
import sys

from loguru import logger
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.pending_payment_sweeper import sweep_pending_payments


def main() -> int:
    if not settings.PENDING_SWEEP_ENABLED:
        logger.info(
            "sweeper: PENDING_SWEEP_ENABLED=false; job exiting without processing"
        )
        return 0

    with Session(engine) as db:
        summary = asyncio.run(
            sweep_pending_payments(
                db,
                threshold_minutes=settings.PENDING_SWEEP_STALE_MINUTES,
                batch_size=settings.PENDING_SWEEP_BATCH_SIZE,
            )
        )

    logger.info("sweeper: job finished summary={}", summary)
    return 1 if summary.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
