"""Add self_check_in_enabled to popups.

Revision ID: 6c1d2e3f4a5b
Revises: b2c4e6f8a1d3
Create Date: 2026-05-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6c1d2e3f4a5b"
down_revision: str = "b2c4e6f8a1d3"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "self_check_in_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "self_check_in_enabled")
