"""Per-popup automatic reminder cadence columns.

Adds three nullable config blocks to ``popups`` (one per reminder type:
abandoned_cart, purchase_reminder, abandoned_application). For each type,
``_delay_days`` is the enable switch (null = off) plus the delay after the
triggering condition; ``_repeat_days`` is the resend interval (null = single
send); ``_max_count`` caps total sends. Read by the reminder dispatch cron.

``popups`` is already RLS-enabled with tenant grants, so adding nullable
columns needs no permission changes.

Revision ID: d5b8e2f1a9c4
Revises: c4e9a1b7d3f2
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5b8e2f1a9c4"
down_revision: str | Sequence[str] | None = "c4e9a1b7d3f2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


_COLUMNS = (
    "abandoned_cart_delay_days",
    "abandoned_cart_repeat_days",
    "abandoned_cart_max_count",
    "purchase_reminder_delay_days",
    "purchase_reminder_repeat_days",
    "purchase_reminder_max_count",
    "abandoned_application_delay_days",
    "abandoned_application_repeat_days",
    "abandoned_application_max_count",
)


def upgrade() -> None:
    for column in _COLUMNS:
        op.add_column("popups", sa.Column(column, sa.Integer(), nullable=True))


def downgrade() -> None:
    for column in reversed(_COLUMNS):
        op.drop_column("popups", column)
