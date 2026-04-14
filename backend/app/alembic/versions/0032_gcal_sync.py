"""Phase 2b — Google Calendar OAuth sync for humans.

Revision ID: 0032_gcal_sync
Revises: 0031_events_phase1
Create Date: 2026-04-14

Adds:
- human_google_credentials: OAuth tokens per human (one row per human).
- event_gcal_sync: tracks the gcal_event_id mirrored in the human's calendar
  for each (event, human) pair, so we can idempotently upsert/delete.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "0032_gcal_sync"
down_revision = "0031_events_phase1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # human_google_credentials — OAuth tokens, one row per human.
    # ------------------------------------------------------------------
    op.create_table(
        "human_google_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "human_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("access_token", sa.Text, nullable=True),
        sa.Column("refresh_token", sa.Text, nullable=False),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scope", sa.Text, nullable=True),
        sa.Column(
            "google_calendar_id",
            sa.Text,
            nullable=False,
            server_default="primary",
        ),
        sa.Column("revoked", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    add_tenant_table_permissions("human_google_credentials")

    # ------------------------------------------------------------------
    # event_gcal_sync — mirrors (event, human) -> Google Calendar event id.
    # ------------------------------------------------------------------
    op.create_table(
        "event_gcal_sync",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "human_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("gcal_event_id", sa.Text, nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("etag", sa.Text, nullable=True),
        sa.UniqueConstraint("event_id", "human_id", name="uq_event_gcal_sync"),
    )
    add_tenant_table_permissions("event_gcal_sync")


def downgrade() -> None:
    remove_tenant_table_permissions("event_gcal_sync")
    op.drop_table("event_gcal_sync")

    remove_tenant_table_permissions("human_google_credentials")
    op.drop_table("human_google_credentials")
