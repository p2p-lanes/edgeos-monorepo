"""Add popup checkout OTP toggle

Revision ID: 8b1f6e2c4d7a
Revises: 4f2b3c1d9e8a
Create Date: 2026-04-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8b1f6e2c4d7a"
down_revision: str = "4f2b3c1d9e8a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "checkout_otp_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "checkout_otp_enabled")
