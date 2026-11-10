"""Store encrypted tenant GA4 Measurement Protocol API secret.

Revision ID: 3e8a9b2c7d14
Revises: cd7cc70ae32b
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3e8a9b2c7d14"
down_revision: str | Sequence[str] | None = "cd7cc70ae32b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenants", sa.Column("ga_mp_api_secret_encrypted", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tenants", "ga_mp_api_secret_encrypted")
