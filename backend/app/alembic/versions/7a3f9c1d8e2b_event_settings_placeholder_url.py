"""event_settings placeholder_url

Adds nullable event_settings.placeholder_url (TEXT) — popup-scoped fallback
image used by the portal when an individual event has no cover image.

Revision ID: 7a3f9c1d8e2b
Revises: d4b1e7a9c2f5
Create Date: 2026-05-30
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "7a3f9c1d8e2b"
down_revision = "d4b1e7a9c2f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_settings",
        sa.Column("placeholder_url", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("event_settings", "placeholder_url")
