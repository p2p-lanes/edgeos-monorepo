"""Persist GA4 browser identifiers on payments for delayed settlement.

Revision ID: 7f2c6d8e4a91
Revises: 3e8a9b2c7d14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "7f2c6d8e4a91"
down_revision: str | Sequence[str] | None = "3e8a9b2c7d14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("ga_client_id", sa.String(length=128), nullable=True)
    )
    op.add_column(
        "payments", sa.Column("ga_session_id", sa.String(length=20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("payments", "ga_session_id")
    op.drop_column("payments", "ga_client_id")
