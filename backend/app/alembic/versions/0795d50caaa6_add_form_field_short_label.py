"""add short_label column to formfields

Revision ID: 0795d50caaa6
Revises: e88d72173244
Create Date: 2026-07-24

"""

import sqlalchemy as sa
from alembic import op

revision = "0795d50caaa6"
down_revision = "e88d72173244"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "formfields",
        sa.Column("short_label", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("formfields", "short_label")
