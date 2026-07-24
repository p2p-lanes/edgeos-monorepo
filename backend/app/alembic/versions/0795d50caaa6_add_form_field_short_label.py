"""add short_label column to formfields

Revision ID: 0795d50caaa6
Revises: 3d1b2dce2b7b
Create Date: 2026-07-24

"""

import sqlalchemy as sa
from alembic import op

revision = "0795d50caaa6"
down_revision = "3d1b2dce2b7b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "formfields",
        sa.Column("short_label", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("formfields", "short_label")
