"""Add GA tracking config to tenants.

Revision ID: c58bb16def73
Revises: 70b397330323
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c58bb16def73"
down_revision: str | Sequence[str] | None = "70b397330323"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "ga_tracking_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "tenants", sa.Column("ga_measurement_id", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tenants", "ga_measurement_id")
    op.drop_column("tenants", "ga_tracking_enabled")
