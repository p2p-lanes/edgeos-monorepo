"""Event attendance modes and check-in history (SIM-106).

Adds ``events.attendance_mode`` (none / host_rollcall / self_checkin) and
the ``event_check_ins`` table, which keeps every attendance mark and its
annulment instead of overwriting ``event_participants.status``.

Backfill, so the QR check-ins already taken under SIM-103 stay coherent:

* events with a checked-in participant become ``self_checkin``: that is
  the mode they were effectively running in, and an event with a check-in
  may not sit in ``none``;
* each checked-in participation gets one history row. Its actor is
  unknown, and it is recorded as holding an RSVP so a later void never
  frees a seat that may have been reserved.

Enum columns store the member *name* (``CHECKED_IN``, ``SELF_CHECKIN``),
matching how SQLModel persists the other enum columns on these tables.

Revision ID: e3b7a91c5d20
Revises: c4e81a2d7f90
"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "e3b7a91c5d20"
down_revision = "c4e81a2d7f90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "attendance_mode",
            sa.String(20),
            nullable=False,
            server_default="NONE",
        ),
    )

    op.create_table(
        "event_check_ins",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Uuid(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "event_id",
            sa.Uuid(),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "participant_id",
            sa.Uuid(),
            sa.ForeignKey("event_participants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("profile_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("occurrence_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("method", sa.String(20), nullable=False),
        sa.Column(
            "had_rsvp", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("checked_in_by_human_id", sa.Uuid(), nullable=True),
        sa.Column("checked_in_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("checked_in_by_name", sa.String(255), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by_human_id", sa.Uuid(), nullable=True),
        sa.Column("voided_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("voided_by_name", sa.String(255), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "uq_event_check_ins_active_participant",
        "event_check_ins",
        ["participant_id"],
        unique=True,
        postgresql_where=sa.text("voided_at IS NULL"),
    )
    op.create_index(
        "ix_event_check_ins_event_occurrence",
        "event_check_ins",
        ["event_id", "occurrence_start"],
    )
    add_tenant_table_permissions("event_check_ins")

    op.execute(
        """
        UPDATE events SET attendance_mode = 'SELF_CHECKIN'
        WHERE id IN (
            SELECT DISTINCT event_id FROM event_participants
            WHERE status = 'CHECKED_IN'
        )
        """
    )
    op.execute(
        """
        INSERT INTO event_check_ins (
            id, tenant_id, event_id, participant_id, profile_id,
            occurrence_start, method, had_rsvp, checked_in_at, created_at
        )
        SELECT
            gen_random_uuid(), tenant_id, event_id, id, profile_id,
            occurrence_start, 'QR', true,
            COALESCE(check_time, updated_at), now()
        FROM event_participants
        WHERE status = 'CHECKED_IN'
        """
    )


def downgrade() -> None:
    remove_tenant_table_permissions("event_check_ins")
    op.drop_index(
        "ix_event_check_ins_event_occurrence", table_name="event_check_ins"
    )
    op.drop_index(
        "uq_event_check_ins_active_participant", table_name="event_check_ins"
    )
    op.drop_table("event_check_ins")
    op.drop_column("events", "attendance_mode")
