"""Add event_hidden_by_human table for per-human event hiding.

Each row records "human H has hidden event E". The portal list endpoint
filters them out by default; a ``include_hidden=true`` query param lets the
user see them again so they can un-hide. Recurrence: hiding an occurrence
hides the series master, which the list filter then expands to all
children via ``recurrence_master_id``.

Revision ID: 0035_event_hidden_by_human
Revises: merge_0014_0034_events
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "0035_event_hidden_by_human"
down_revision = "merge_0014_0034_events"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "event_hidden_by_human",
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
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "human_id", "event_id", name="uq_event_hidden_human_event"
        ),
    )
    # RLS + grants for tenant_role/tenant_viewer_role. Without this, the app
    # (which connects as a tenant role) gets "permission denied" on SELECT.
    add_tenant_table_permissions("event_hidden_by_human")


def downgrade():
    remove_tenant_table_permissions("event_hidden_by_human")
    op.drop_table("event_hidden_by_human")
