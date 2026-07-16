"""Add Meta tracking config to tenants.

Revision ID: 1f4b9d8c2e6a
Revises: d4e8f1a92b67
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "1f4b9d8c2e6a"
down_revision: str | Sequence[str] | None = "d4e8f1a92b67"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "meta_tracking_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "tenants", sa.Column("meta_pixel_id", sa.String(length=64), nullable=True)
    )
    op.add_column(
        "tenants",
        sa.Column("meta_capi_access_token_encrypted", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenants", "meta_capi_access_token_encrypted")
    op.drop_column("tenants", "meta_pixel_id")
    op.drop_column("tenants", "meta_tracking_enabled")
