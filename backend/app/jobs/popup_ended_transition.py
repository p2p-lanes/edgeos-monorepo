"""Entrypoint for the popup ended-transition job.

Designed to be invoked by an external scheduler (k8s CronJob, EventBridge
Schedule -> ECS RunTask, systemd timer, plain crontab).

Usage:
    uv run python -m app.jobs.popup_ended_transition

Exit codes:
    0 — run completed (possibly a no-op when no popup is due)
    1 — run completed but at least one popup failed; check logs

Recommended interval: hourly.
"""

import sys

from loguru import logger
from sqlmodel import Session

from app.core.db import engine
from app.services.popup_ended_transition import transition_ended_popups


def main() -> int:
    with Session(engine) as db:
        summary = transition_ended_popups(db)
    logger.info("Popup ended-transition finished: {}", summary)
    return 1 if summary.get("failures") else 0


if __name__ == "__main__":
    sys.exit(main())
