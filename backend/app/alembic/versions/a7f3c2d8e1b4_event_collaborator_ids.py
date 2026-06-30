"""event collaborator_ids

Adds events.collaborator_ids (uuid[], NOT NULL, default '{}') — the humans who
collaborate on an event. Each id grants the same manage rights as the owner /
host (edit / cancel / invitations). Generalizes the single host_id from 1 -> N.
Stored as a native uuid[] (not JSONB) so membership checks and serialization
round-trip as real UUIDs. No FK constraint, mirroring owner_id / host_id.

Revision ID: a7f3c2d8e1b4
Revises: b3d8f1a25c47
Create Date: 2026-06-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

# revision identifiers, used by Alembic.
revision = "a7f3c2d8e1b4"
down_revision = "b3d8f1a25c47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "collaborator_ids",
            ARRAY(UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("events", "collaborator_ids")
