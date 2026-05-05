"""Add ``events_require_approval`` flag to event_settings.

Mirrors ``venues_require_approval`` but for events: when a popup allows
"everyone" to create events, this flag controls whether human-submitted
events go into PENDING_APPROVAL instead of being published directly.

Revision ID: 0041_events_require_approval
Revises: 0040_event_highlighted
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa


revision: str = "0041_events_require_approval"
down_revision: str | None = "0040_event_highlighted"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_settings",
        sa.Column(
            "events_require_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("event_settings", "events_require_approval")
