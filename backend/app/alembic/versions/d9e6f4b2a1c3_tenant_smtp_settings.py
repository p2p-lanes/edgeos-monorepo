"""Add tenant-level SMTP settings.

Revision ID: d9e6f4b2a1c3
Revises: b8d2f3a47c19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d9e6f4b2a1c3"
down_revision: str | Sequence[str] | None = "b8d2f3a47c19"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("smtp_host", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("smtp_port", sa.Integer(), nullable=True))
    op.add_column("tenants", sa.Column("smtp_user", sa.String(length=255), nullable=True))
    op.add_column(
        "tenants", sa.Column("smtp_password_encrypted", sa.Text(), nullable=True)
    )
    op.add_column("tenants", sa.Column("smtp_tls", sa.Boolean(), nullable=True))
    op.add_column("tenants", sa.Column("smtp_ssl", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "smtp_ssl")
    op.drop_column("tenants", "smtp_tls")
    op.drop_column("tenants", "smtp_password_encrypted")
    op.drop_column("tenants", "smtp_user")
    op.drop_column("tenants", "smtp_port")
    op.drop_column("tenants", "smtp_host")
