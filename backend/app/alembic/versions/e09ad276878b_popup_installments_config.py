"""Add per-popup installment-plan configuration columns.

Adds five columns to the popups table that drive whether/how the SimpleFi
installment-plan flow is offered for a popup:

  installments_enabled         — opt-in flag (default false)
  installments_deadline        — last date by which all installments must be paid
  installments_max             — per-popup ceiling (validated 2..12 in schema)
  installments_interval        — day | week | month | year (default month)
  installments_interval_count  — multiplier on the interval (default 1)

Existing popups become installments-disabled with month/1 defaults; no behavior
change until an operator turns the feature on.

Revision ID: e09ad276878b
Revises: 377c2c02fe74
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e09ad276878b"
down_revision: str | Sequence[str] | None = "377c2c02fe74"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "installments_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "installments_deadline",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "popups",
        sa.Column("installments_max", sa.Integer(), nullable=True),
    )
    op.add_column(
        "popups",
        sa.Column(
            "installments_interval",
            sa.String(),
            nullable=False,
            server_default="month",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "installments_interval_count",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "installments_interval_count")
    op.drop_column("popups", "installments_interval")
    op.drop_column("popups", "installments_max")
    op.drop_column("popups", "installments_deadline")
    op.drop_column("popups", "installments_enabled")
