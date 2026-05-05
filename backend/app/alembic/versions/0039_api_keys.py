"""Add api_keys table for portal-user (human) API key authentication.

Each row is a personal access token owned by a Human, scoped to a tenant.
The raw token is shown to the user only at creation time; we persist a
sha256 digest (peppered with SECRET_KEY) plus a short display prefix.

Auth path: when a request arrives with ``Authorization: Bearer eos_...``,
the security layer hashes the candidate, looks up the row, validates it
isn't revoked or expired, and synthesises a TokenPayload identical to
what a regular human JWT would yield. The key inherits the owner's
permissions on every downstream route.

Revision ID: 0039_api_keys
Revises: 0038_rsvp_occurrence_start
Create Date: 2026-04-27
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "0039_api_keys"
down_revision: str | None = "0038_rsvp_occurrence_start"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "human_id",
            sa.Uuid(),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("prefix", sa.String(length=20), nullable=False),
        sa.Column(
            "last_used_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "revoked_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "expires_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("key_hash", name="uq_api_keys_key_hash"),
    )
    op.create_index(
        "ix_api_keys_human_revoked",
        "api_keys",
        ["human_id", "revoked_at"],
    )
    add_tenant_table_permissions("api_keys")


def downgrade() -> None:
    remove_tenant_table_permissions("api_keys")
    op.drop_index("ix_api_keys_human_revoked", table_name="api_keys")
    op.drop_table("api_keys")
