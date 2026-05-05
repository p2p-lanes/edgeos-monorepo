"""Add events_enabled feature flag to popups.

Revision ID: 0042_popup_events_enabled
Revises: c8a9f4e2b1d7
Create Date: 2026-05-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_popup_events_enabled"
down_revision: str | None = "c8a9f4e2b1d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "events_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "events_enabled")
