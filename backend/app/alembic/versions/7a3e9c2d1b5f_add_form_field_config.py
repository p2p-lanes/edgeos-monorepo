"""add config jsonb column to formfields

Revision ID: 7a3e9c2d1b5f
Revises: fb7da98c8d72
Create Date: 2026-05-15

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "7a3e9c2d1b5f"
down_revision = "fb7da98c8d72"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "formfields",
        sa.Column("config", JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("formfields", "config")
