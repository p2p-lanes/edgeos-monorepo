"""Purge expired third-party grants; run daily against the intended environment.

Usage: cd backend && uv run python scripts/purge_third_party_grants.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger  # noqa: E402
from sqlmodel import Session  # noqa: E402

import app.models  # noqa: F401,E402
from app.api.third_party_auth.service import purge_expired_grants  # noqa: E402
from app.core.db import engine  # noqa: E402


def main() -> None:
    total = 0
    with Session(engine) as db:
        while count := purge_expired_grants(db):
            total += count
    logger.info("Purged {} expired third-party grants", total)


if __name__ == "__main__":
    main()
