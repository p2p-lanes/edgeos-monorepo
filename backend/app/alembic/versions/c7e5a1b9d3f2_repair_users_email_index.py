"""Repair a legacy globally unique users email index.

Revision ID: c7e5a1b9d3f2
Revises: b6d4e9f2a1c7
Create Date: 2026-09-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c7e5a1b9d3f2"
down_revision: str | None = "b6d4e9f2a1c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    is_unique = conn.execute(
        sa.text(
            """
            SELECT indisunique
            FROM pg_index
            WHERE indexrelid = to_regclass('public.ix_users_email')
            """
        )
    ).scalar_one_or_none()

    # Healthy databases already have this non-unique lookup index. Rebuild only
    # drifted or missing indexes to avoid an unnecessary table lock.
    if is_unique is not False:
        op.drop_index("ix_users_email", table_name="users", if_exists=True)
        op.create_index("ix_users_email", "users", ["email"], unique=False)


def downgrade() -> None:
    # Restoring global uniqueness could fail after valid cross-tenant or
    # soft-deleted email reuse, so the repair is intentionally irreversible.
    pass
