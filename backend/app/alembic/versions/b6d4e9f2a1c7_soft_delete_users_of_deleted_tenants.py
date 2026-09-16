"""Soft-delete users belonging to already deleted tenants.

Revision ID: b6d4e9f2a1c7
Revises: a5c8e2f7b1d4
Create Date: 2026-09-04
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b6d4e9f2a1c7"
down_revision: str | None = "a5c8e2f7b1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET deleted = true,
            auth_code = NULL,
            code_expiration = NULL,
            auth_attempts = 0
        WHERE deleted = false
          AND tenant_id IN (
              SELECT id
              FROM tenants
              WHERE deleted = true
          )
        """
    )


def downgrade() -> None:
    # Irreversible: we cannot distinguish users deleted with their tenant from
    # users that were independently deleted before this migration.
    pass
