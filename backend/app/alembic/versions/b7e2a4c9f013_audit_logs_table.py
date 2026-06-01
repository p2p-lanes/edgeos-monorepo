"""Create audit_logs table — generic admin action history.

WHY:
EdgeOS had no queryable audit trail. Admin actions (ticket swaps, grants,
removals, and future events like product price edits or human deletions) need a
persistent who/what/when record. This table is the generic, extensible store:
new event types add a row, never a column.

WHAT (upgrade):
1. CREATE TABLE audit_logs (RLS via add_tenant_table_permissions).
   actor_user_id / entity_id / popup_id are plain indexed UUIDs with NO foreign
   keys — audit logs must outlive the entities they reference, so references are
   denormalized (with *_label snapshots) rather than constrained.

Downgrade drops the table.

Revision ID: b7e2a4c9f013
Revises: 7a3f9c1d8e2b
Create Date: 2026-06-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "b7e2a4c9f013"
down_revision = "7a3f9c1d8e2b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        # Actor — denormalized, no FK so the log survives user deletion.
        sa.Column("actor_user_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("actor_label", sa.String(), nullable=False),
        # Action — namespaced "<entity>.<verb>".
        sa.Column("action", sa.String(), nullable=False, index=True),
        # Primary entity the event groups under (entity_id is polymorphic, no FK).
        sa.Column("entity_type", sa.String(), nullable=False, index=True),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("entity_label", sa.String(), nullable=True),
        # Popup scope for the global feed filter — denormalized, no FK.
        sa.Column("popup_id", UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("details", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            index=True,
        ),
    )

    # Tenant-scoped RLS — same pattern as every other tenant table.
    add_tenant_table_permissions("audit_logs")


def downgrade() -> None:
    remove_tenant_table_permissions("audit_logs")
    op.drop_table("audit_logs")
