"""add buyer_snapshot JSONB column to payments (open ticketing)

Revision ID: 3f8a1c9e4b2d
Revises: 70a7aa572262
Create Date: 2026-04-30 21:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "3f8a1c9e4b2d"
down_revision: str = "70a7aa572262"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column(
            "buyer_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("payments", "buyer_snapshot")
