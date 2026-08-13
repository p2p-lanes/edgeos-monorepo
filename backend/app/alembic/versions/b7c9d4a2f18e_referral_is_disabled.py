"""Add is_disabled to referrals for admin force-disable.

Revision ID: b7c9d4a2f18e
Revises: c7a4e2f1b8d3
Create Date: 2026-07-29

"""

import sqlalchemy as sa
from alembic import op

revision = "b7c9d4a2f18e"
down_revision = "c7a4e2f1b8d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "referrals",
        sa.Column(
            "is_disabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("referrals", "is_disabled")
