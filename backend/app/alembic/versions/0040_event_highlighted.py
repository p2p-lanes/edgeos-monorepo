"""Add ``highlighted`` flag to events.

Lets backoffice operators mark a small number of "special" events that the
portal renders with a distinct visual treatment.

Revision ID: 0040_event_highlighted
Revises: 0039_api_keys
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa


revision: str = "0040_event_highlighted"
down_revision: str | None = "0039_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "highlighted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "highlighted")
