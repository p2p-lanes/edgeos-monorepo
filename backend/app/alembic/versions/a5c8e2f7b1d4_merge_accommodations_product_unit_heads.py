"""Merge accommodations and ProductUnit history heads.

Revision ID: a5c8e2f7b1d4
Revises: e2a7c4d9f1b6, f4b8c2d7e1a9
Create Date: 2026-09-02
"""

from collections.abc import Sequence

revision: str = "a5c8e2f7b1d4"
down_revision: tuple[str, str] = ("e2a7c4d9f1b6", "f4b8c2d7e1a9")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
