"""add composite index human_popup on attendees

Revision ID: 70a7aa572262
Revises: 4f2b3c1d9e8a
Create Date: 2026-04-30 15:48:19.041861

Performance pre-condition for the unified human-popup attendee query:
  find_by_human_popup(session, human_id, popup_id)

Without this index, the query degrades to a full table scan filtered by
human_id (cardinality: 100s-1000s of rows per popup). With the index,
the planner performs an index-only scan returning <10 rows per human.

No DDL grants needed — index inherits table grants from 'attendees'.
No RLS interaction — RLS policies filter by tenant_id (orthogonal).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "70a7aa572262"
down_revision = "4f2b3c1d9e8a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_attendees_human_popup",
        "attendees",
        ["human_id", "popup_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_attendees_human_popup", table_name="attendees")

