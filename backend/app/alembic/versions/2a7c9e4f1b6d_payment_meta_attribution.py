"""Add Meta attribution fields to payments.

Revision ID: 2a7c9e4f1b6d
Revises: 1f4b9d8c2e6a
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "2a7c9e4f1b6d"
down_revision: str | Sequence[str] | None = "1f4b9d8c2e6a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("meta_fbc", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "payments", sa.Column("meta_fbp", sa.String(length=512), nullable=True)
    )
    op.add_column(
        "payments", sa.Column("meta_client_ip", sa.String(length=128), nullable=True)
    )
    op.add_column(
        "payments", sa.Column("meta_client_user_agent", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("payments", "meta_client_user_agent")
    op.drop_column("payments", "meta_client_ip")
    op.drop_column("payments", "meta_fbp")
    op.drop_column("payments", "meta_fbc")
