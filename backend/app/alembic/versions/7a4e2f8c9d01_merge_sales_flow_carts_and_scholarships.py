"""Merge sales-flow carts and scholarship backfill heads.

Revision ID: 7a4e2f8c9d01
Revises: c4d8e6f1a2b3, f3c9a1d7e2b4
Create Date: 2026-08-26 16:20:00.000000
"""

from collections.abc import Sequence

revision: str = "7a4e2f8c9d01"
down_revision: tuple[str, str] | Sequence[str] | None = (
    "c4d8e6f1a2b3",
    "f3c9a1d7e2b4",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
