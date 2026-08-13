"""Add popup_publishable_keys table.

Non-secret, browser-safe keys that let an externally-hosted checkout UI
resolve a popup's tenant (guarded by an origin allowlist, not secrecy).

Revision ID: f1a2b3c4d5e6
Revises: a7f2c9e4b183
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "a7f2c9e4b183"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "popup_publishable_keys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            sa.Uuid(),
            sa.ForeignKey("popups.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("key_prefix", sa.String(length=20), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "allowed_origins",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("key_hash", name="uq_popup_publishable_keys_key_hash"),
    )
    op.create_index(
        "ix_popup_publishable_keys_popup_revoked",
        "popup_publishable_keys",
        ["popup_id", "revoked_at"],
    )
    add_tenant_table_permissions("popup_publishable_keys")


def downgrade() -> None:
    remove_tenant_table_permissions("popup_publishable_keys")
    op.drop_index(
        "ix_popup_publishable_keys_popup_revoked",
        table_name="popup_publishable_keys",
    )
    op.drop_table("popup_publishable_keys")
