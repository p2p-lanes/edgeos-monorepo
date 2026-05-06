"""Add custom_location_name + custom_location_url to events.

Lets users attach an ad-hoc location (place name + maps URL) to an event
without needing an admin to provision an EventVenues row first. The pair
is XOR with ``venue_id`` and is enforced at the schema layer.

Revision ID: 0044_event_custom_location
Revises: 0043_tenant_scoped_popup_slug
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op


revision: str = "0044_event_custom_location"
down_revision: str | None = "0043_tenant_scoped_popup_slug"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("custom_location_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("custom_location_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "custom_location_url")
    op.drop_column("events", "custom_location_name")
