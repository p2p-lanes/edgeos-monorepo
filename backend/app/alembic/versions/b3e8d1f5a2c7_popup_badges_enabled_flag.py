"""Add badges feature flag to popups.

Revision ID: b3e8d1f5a2c7
Revises: f7c2b9e4a6d1
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3e8d1f5a2c7"
down_revision: str = "f7c2b9e4a6d1"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Opt-in: every existing popup starts with badges off.
    op.add_column(
        "popups",
        sa.Column(
            "badges_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "badges_enabled")
