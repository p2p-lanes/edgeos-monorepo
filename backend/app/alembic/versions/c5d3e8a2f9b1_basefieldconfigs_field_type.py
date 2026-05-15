"""add field_type override column to basefieldconfigs

Revision ID: c5d3e8a2f9b1
Revises: merge_0049_8b4d5e6f
Create Date: 2026-05-15

"""

import sqlalchemy as sa
from alembic import op

revision = "c5d3e8a2f9b1"
down_revision = "merge_0049_8b4d5e6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "basefieldconfigs",
        sa.Column("field_type", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("basefieldconfigs", "field_type")
