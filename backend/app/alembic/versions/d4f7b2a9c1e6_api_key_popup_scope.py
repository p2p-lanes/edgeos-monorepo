"""Bind human-owned API keys to a single popup.

Adds ``api_keys.popup_id`` (FK popups.id, indexed). Human-owned keys are
attendee keys (identity = human_id + popup_id); the column is nullable at
the table level only because admin-owned keys (user_id set) have no popup.

Data migration: revokes every active human-owned key. Legacy keys were
tenant-wide (no popup binding) and are unsafe under the new popup-scoped
enforcement, so they are revoked rather than backfilled. Admin-owned keys
are untouched.

Revision ID: d4f7b2a9c1e6
Revises: a8e3d7f4c2b9
Create Date: 2026-07-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4f7b2a9c1e6"
down_revision: str | None = "a8e3d7f4c2b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column(
            "popup_id",
            sa.Uuid(),
            sa.ForeignKey("popups.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_api_keys_popup_id", "api_keys", ["popup_id"])

    # Revoke all legacy human-owned keys: they predate popup scoping and
    # would otherwise fail closed (403) on every portal route anyway.
    # DML, so plain SQL through op.execute is fine.
    op.execute(
        "UPDATE api_keys SET revoked_at = now() "
        "WHERE human_id IS NOT NULL AND revoked_at IS NULL"
    )


def downgrade() -> None:
    # NOTE: the revocation of legacy human-owned keys above is irreversible;
    # downgrading only drops the column and index.
    op.drop_index("ix_api_keys_popup_id", table_name="api_keys")
    op.drop_column("api_keys", "popup_id")
