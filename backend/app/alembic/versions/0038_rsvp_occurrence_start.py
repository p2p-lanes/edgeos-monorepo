"""Per-occurrence RSVP support.

A row in ``event_participants`` previously identified a registration by
``(event_id, profile_id)``. For recurring events this meant a single RSVP
counted as "going" for every expanded occurrence of the series, which is
wrong: a user RSVPs to one specific instance.

This migration:

  * Adds ``occurrence_start TIMESTAMPTZ NULL`` to ``event_participants``.
    ``NULL`` is reserved for one-off events (no series).
  * Replaces the unique constraint with two partial unique indexes so
    ``NULL`` and ``NOT NULL`` rows enforce uniqueness independently.
    (Postgres treats ``NULL`` as distinct under standard ``UNIQUE``,
    which would let multiple ``NULL`` rows collide on the same one-off
    event — partial indexes give us the semantics we want.)

Revision ID: 0038_rsvp_occurrence_start
Revises: 0036_event_kinds_no_amenities
Create Date: 2026-04-27 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_rsvp_occurrence_start"
down_revision: str | None = "0036_event_kinds_no_amenities"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "event_participants",
        sa.Column("occurrence_start", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_constraint(
        "uq_event_participant", "event_participants", type_="unique"
    )
    op.create_index(
        "uq_event_participant_oneoff",
        "event_participants",
        ["event_id", "profile_id"],
        unique=True,
        postgresql_where=sa.text("occurrence_start IS NULL"),
    )
    op.create_index(
        "uq_event_participant_occurrence",
        "event_participants",
        ["event_id", "profile_id", "occurrence_start"],
        unique=True,
        postgresql_where=sa.text("occurrence_start IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_event_participant_occurrence", table_name="event_participants"
    )
    op.drop_index(
        "uq_event_participant_oneoff", table_name="event_participants"
    )
    op.create_unique_constraint(
        "uq_event_participant",
        "event_participants",
        ["event_id", "profile_id"],
    )
    op.drop_column("event_participants", "occurrence_start")
