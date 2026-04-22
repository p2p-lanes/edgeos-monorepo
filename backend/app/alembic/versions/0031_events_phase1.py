"""Events module phase 1: venue booking, photos, weekly hours, exceptions,
properties catalog, tracks, invitations, event visibility.

Revision ID: 0031_events_phase1
Revises: 0030_events_module
Create Date: 2026-04-14

Adds:
- event_settings: humans_can_create_venues, venues_require_approval
- event_venues: booking_mode, setup_time_minutes, teardown_time_minutes, status
- events: visibility, track_id (+ drop location/geo_lat/geo_lng)
- tracks (new)
- venue_weekly_hours (new)
- venue_exceptions (new)
- venue_property_types (new, tenant catalog)
- venue_properties (new, M2M)
- venue_photos (new, gallery)
- event_invitations (new)
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "0031_events_phase1"
down_revision = "0030_events_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # event_settings — new flags
    # ------------------------------------------------------------------
    op.add_column(
        "event_settings",
        sa.Column(
            "humans_can_create_venues",
            sa.Boolean,
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "event_settings",
        sa.Column(
            "venues_require_approval",
            sa.Boolean,
            nullable=False,
            server_default="true",
        ),
    )

    # ------------------------------------------------------------------
    # event_venues — booking mode, setup/teardown, approval status
    # ------------------------------------------------------------------
    op.add_column(
        "event_venues",
        sa.Column(
            "booking_mode",
            sa.String(30),
            nullable=False,
            server_default="free",
        ),
    )
    op.add_column(
        "event_venues",
        sa.Column(
            "setup_time_minutes",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "event_venues",
        sa.Column(
            "teardown_time_minutes",
            sa.Integer,
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "event_venues",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="active",
        ),
    )

    # ------------------------------------------------------------------
    # tracks (new) — groups of related events (ie. a course with classes)
    # ------------------------------------------------------------------
    op.create_table(
        "tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("topic", postgresql.JSONB, nullable=False, server_default="[]"),
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
    add_tenant_table_permissions("tracks")

    # ------------------------------------------------------------------
    # events — visibility, track_id; drop legacy location fields
    # ------------------------------------------------------------------
    op.add_column(
        "events",
        sa.Column(
            "visibility",
            sa.String(20),
            nullable=False,
            server_default="public",
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "track_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tracks.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    # Location is defined by the venue now.
    op.drop_column("events", "location")
    op.drop_column("events", "geo_lat")
    op.drop_column("events", "geo_lng")

    # ------------------------------------------------------------------
    # venue_weekly_hours — one row per (venue, day_of_week). ISO weekday:
    # 0 = Monday, 6 = Sunday. Rows only exist for configured days; missing
    # rows mean "closed by default".
    # ------------------------------------------------------------------
    op.create_table(
        "venue_weekly_hours",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "venue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_venues.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("day_of_week", sa.Integer, nullable=False),
        sa.Column("open_time", sa.Time(timezone=False), nullable=True),
        sa.Column("close_time", sa.Time(timezone=False), nullable=True),
        sa.Column("is_closed", sa.Boolean, nullable=False, server_default="false"),
        sa.UniqueConstraint("venue_id", "day_of_week", name="uq_venue_day"),
        sa.CheckConstraint(
            "day_of_week >= 0 AND day_of_week <= 6",
            name="ck_venue_weekly_hours_day",
        ),
    )
    add_tenant_table_permissions("venue_weekly_hours")

    # ------------------------------------------------------------------
    # venue_exceptions — date/datetime range overrides to weekly hours.
    # is_closed=true blocks bookings; is_closed=false opens an otherwise
    # closed slot.
    # ------------------------------------------------------------------
    op.create_table(
        "venue_exceptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "venue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_venues.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("is_closed", sa.Boolean, nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_venue_exceptions_range",
        "venue_exceptions",
        ["venue_id", "start_datetime", "end_datetime"],
    )
    add_tenant_table_permissions("venue_exceptions")

    # ------------------------------------------------------------------
    # venue_property_types — tenant-scoped catalog (microphone, screen,
    # chairs, etc.)
    # ------------------------------------------------------------------
    op.create_table(
        "venue_property_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("icon", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("tenant_id", "name", name="uq_venue_property_type_name"),
    )
    add_tenant_table_permissions("venue_property_types")

    # ------------------------------------------------------------------
    # venue_properties — M2M venue<->property_type
    # ------------------------------------------------------------------
    op.create_table(
        "venue_properties",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "venue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_venues.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "property_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("venue_property_types.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.UniqueConstraint("venue_id", "property_type_id", name="uq_venue_property"),
    )
    add_tenant_table_permissions("venue_properties")

    # ------------------------------------------------------------------
    # venue_photos — gallery (up to 10 enforced at app layer)
    # ------------------------------------------------------------------
    op.create_table(
        "venue_photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "venue_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("event_venues.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("image_url", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_venue_photos_venue_position", "venue_photos", ["venue_id", "position"]
    )
    add_tenant_table_permissions("venue_photos")

    # ------------------------------------------------------------------
    # event_invitations — for private/unlisted events, the set of humans
    # who can view/RSVP.
    # ------------------------------------------------------------------
    op.create_table(
        "event_invitations",
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
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("event_id", "human_id", name="uq_event_invitation"),
    )
    add_tenant_table_permissions("event_invitations")


def downgrade() -> None:
    remove_tenant_table_permissions("event_invitations")
    op.drop_table("event_invitations")

    op.drop_index("ix_venue_photos_venue_position", table_name="venue_photos")
    remove_tenant_table_permissions("venue_photos")
    op.drop_table("venue_photos")

    remove_tenant_table_permissions("venue_properties")
    op.drop_table("venue_properties")

    remove_tenant_table_permissions("venue_property_types")
    op.drop_table("venue_property_types")

    op.drop_index("ix_venue_exceptions_range", table_name="venue_exceptions")
    remove_tenant_table_permissions("venue_exceptions")
    op.drop_table("venue_exceptions")

    remove_tenant_table_permissions("venue_weekly_hours")
    op.drop_table("venue_weekly_hours")

    op.add_column(
        "events", sa.Column("geo_lng", sa.Float, nullable=True)
    )
    op.add_column(
        "events", sa.Column("geo_lat", sa.Float, nullable=True)
    )
    op.add_column("events", sa.Column("location", sa.Text, nullable=True))
    op.drop_column("events", "track_id")
    op.drop_column("events", "visibility")

    remove_tenant_table_permissions("tracks")
    op.drop_table("tracks")

    op.drop_column("event_venues", "status")
    op.drop_column("event_venues", "teardown_time_minutes")
    op.drop_column("event_venues", "setup_time_minutes")
    op.drop_column("event_venues", "booking_mode")

    op.drop_column("event_settings", "venues_require_approval")
    op.drop_column("event_settings", "humans_can_create_venues")
