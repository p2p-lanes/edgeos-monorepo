"""Add events module tables: events, event_participants, event_venues, event_settings.

Revision ID: 0024_events_module
Revises: 0023_application_fee
Create Date: 2026-04-09

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import add_tenant_table_permissions, remove_tenant_table_permissions

# revision identifiers, used by Alembic.
revision = "0024_events_module"
down_revision = "0023_application_fee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- event_venues ---
    op.create_table(
        "event_venues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("location", sa.Text, nullable=True),
        sa.Column("formatted_address", sa.Text, nullable=True),
        sa.Column("geo_lat", sa.Float, nullable=True),
        sa.Column("geo_lng", sa.Float, nullable=True),
        sa.Column("capacity", sa.Integer, nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("amenities", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("image_url", sa.Text, nullable=True),
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
    add_tenant_table_permissions("event_venues")

    # --- events ---
    op.create_table(
        "events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("location", sa.Text, nullable=True),
        sa.Column("geo_lat", sa.Float, nullable=True),
        sa.Column("geo_lng", sa.Float, nullable=True),
        sa.Column("cover_url", sa.Text, nullable=True),
        sa.Column("meeting_url", sa.Text, nullable=True),
        sa.Column("max_participant", sa.Integer, nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column(
            "venue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_venues.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("require_approval", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("kind", sa.String(100), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
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
    op.create_index(
        "ix_events_popup_status_start",
        "events",
        ["popup_id", "status", "start_time"],
    )
    op.create_index(
        "ix_events_published_lookup",
        "events",
        ["popup_id", "start_time"],
        postgresql_where=sa.text("status = 'published'"),
    )
    add_tenant_table_permissions("events")

    # --- event_participants ---
    op.create_table(
        "event_participants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
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
        sa.Column("profile_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="registered"),
        sa.Column("role", sa.String(20), nullable=False, server_default="attendee"),
        sa.Column("check_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message", sa.Text, nullable=True),
        sa.Column(
            "registered_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
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
        sa.UniqueConstraint("event_id", "profile_id", name="uq_event_participant"),
    )
    op.create_index(
        "ix_event_participants_profile_status",
        "event_participants",
        ["profile_id", "status"],
    )
    op.create_index(
        "ix_event_participants_event_status",
        "event_participants",
        ["event_id", "status"],
    )
    add_tenant_table_permissions("event_participants")

    # --- event_settings ---
    op.create_table(
        "event_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "can_publish_event", sa.String, nullable=False, server_default="everyone"
        ),
        sa.Column("event_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
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
    add_tenant_table_permissions("event_settings")


def downgrade() -> None:
    remove_tenant_table_permissions("event_settings")
    op.drop_table("event_settings")

    remove_tenant_table_permissions("event_participants")
    op.drop_table("event_participants")

    op.drop_index("ix_events_published_lookup", table_name="events")
    op.drop_index("ix_events_popup_status_start", table_name="events")
    remove_tenant_table_permissions("events")
    op.drop_table("events")

    remove_tenant_table_permissions("event_venues")
    op.drop_table("event_venues")
