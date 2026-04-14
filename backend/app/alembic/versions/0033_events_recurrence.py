"""Events module phase 2a: recurrence (RRULE) support.

Revision ID: 0033_events_recurrence
Revises: 0032_gcal_sync
Create Date: 2026-04-14

Adds to events:
- rrule: TEXT NULL — canonical RFC-5545 RRULE for the series master
- recurrence_master_id: UUID NULL FK -> events(id) ON DELETE CASCADE — for
  materialized overrides (detached occurrences)
- recurrence_exdates: JSONB NOT NULL DEFAULT '[]' — ISO8601 datetimes to skip
- Index on recurrence_master_id for fast lookup of overrides.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0033_events_recurrence"
down_revision = "0032_gcal_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("rrule", sa.Text, nullable=True),
    )
    op.add_column(
        "events",
        sa.Column(
            "recurrence_master_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "events",
        sa.Column(
            "recurrence_exdates",
            postgresql.JSONB,
            nullable=False,
            server_default="[]",
        ),
    )
    op.create_index(
        "ix_events_recurrence_master_id",
        "events",
        ["recurrence_master_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_events_recurrence_master_id", table_name="events")
    op.drop_column("events", "recurrence_exdates")
    op.drop_column("events", "recurrence_master_id")
    op.drop_column("events", "rrule")
