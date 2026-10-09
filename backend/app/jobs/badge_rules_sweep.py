"""Entrypoint for the badge rules sweep (SIM-108).

Awards automatic badges to everyone who meets an active rule. This is the
only path that turns attendance into badges: an occurrence counts once its
check-in window has closed (two hours after it ends, when a check-in can no
longer be voided), so the badge lands on the first sweep after that.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule -> ECS RunTask, systemd timer, plain crontab).

Usage:
    uv run python -m app.jobs.badge_rules_sweep

Exit codes:
    0: run completed (possibly a no-op)
    1: run completed but at least one rule failed; check logs

Recommended interval: every 15 minutes.
"""

import sys

from loguru import logger
from sqlmodel import Session

import app.models  # noqa: F401  registers every mapper before we query
from app.api.badge.rules import sweep_badge_rules
from app.core.db import engine


def main() -> int:
    with Session(engine) as db:
        summary = sweep_badge_rules(db)
    logger.info("Badge rules sweep finished: {}", summary)
    return 1 if summary.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
