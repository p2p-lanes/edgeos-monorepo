"""event host_id

Adds nullable events.host_id (UUID, indexed) — the human designated as the
event's host. Grants that host the same manage rights as the owner (edit /
cancel / invitations). Modeled like owner_id: an indexed uuid with no FK
constraint. Set only when a directory human is picked as host; NULL otherwise.

Revision ID: f4a9c1e7b6d2
Revises: b7e2a4c9f013
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "f4a9c1e7b6d2"
down_revision = "b7e2a4c9f013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("host_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_events_host_id", "events", ["host_id"])


def downgrade() -> None:
    op.drop_index("ix_events_host_id", table_name="events")
    op.drop_column("events", "host_id")
