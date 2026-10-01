"""Add per-sales-flow SimpleFi API key override.

Revision ID: c4e81a2d7f90
Revises: d6f2b8a94c31
"""

import sqlalchemy as sa
from alembic import op

revision = "c4e81a2d7f90"
down_revision = "d6f2b8a94c31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_flows", sa.Column("simplefi_api_key", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("sales_flows", "simplefi_api_key")
