"""Make popup_publishable_keys.popup_id optional (tenant-scoped keys).

Publishable keys are now minted at the TENANT level (one key a client reuses
across all the tenant's popups); the resolver already resolves by tenant_id and
never enforced the popup binding. A tenant-level key has no popup, so popup_id
becomes nullable. Existing per-popup rows are unaffected.

Revision ID: c2d4e6f8a1b3
Revises: f1a2b3c4d5e6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c2d4e6f8a1b3"
down_revision: str | Sequence[str] | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "popup_publishable_keys",
        "popup_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )


def downgrade() -> None:
    # Tenant-level keys have NULL popup_id and cannot satisfy a NOT NULL
    # constraint; drop them before re-tightening.
    op.execute("DELETE FROM popup_publishable_keys WHERE popup_id IS NULL")
    op.alter_column(
        "popup_publishable_keys",
        "popup_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
