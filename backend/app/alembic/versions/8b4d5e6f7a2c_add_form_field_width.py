"""add width column to formfields

Revision ID: 8b4d5e6f7a2c
Revises: 7a3e9c2d1b5f
Create Date: 2026-05-15

"""

import sqlalchemy as sa
from alembic import op

revision = "8b4d5e6f7a2c"
down_revision = "7a3e9c2d1b5f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "formfields",
        sa.Column("width", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("formfields", "width")
