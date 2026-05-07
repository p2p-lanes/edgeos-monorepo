"""Rename ticket_events table to check_ins; drop the legacy check_ins table.

Revision ID: c5e9d3b2f8a0
Revises: b4c8d2a1e7f9
Create Date: 2026-05-07

Reasoning:
  The original `ticket_events` table was designed with a generic event_type
  discriminator anticipating future "transfer/refund/edit" events. That
  extensibility was never a real product requirement — the only event type
  ever emitted is `check_in`. The generic naming is over-engineering and
  makes the API surface confusing ("ticket events" reads abstract; users
  think and talk in terms of "check-ins").

  The legacy `check_ins` table (created in 0008_add_check_ins_table.py and
  superseded by `attendee_products.check_in_code` + `ticket_events`) has no
  active readers/writers and no production data — it can be safely dropped.

  After this migration the only check-in table is named `check_ins` and
  carries one row per scan event with full history.

Forward-only. Raises RuntimeError on downgrade.

Steps:
  A. DROP the legacy `check_ins` table (and its RLS policy)
  B. RENAME `ticket_events` → `check_ins`
  C. Rename indexes, FK constraints, RLS policy to use the new table name
  D. DROP `event_type` column (always 'check_in' from now on)
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic
revision = "c5e9d3b2f8a0"
down_revision = "b4c8d2a1e7f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Step A: drop legacy check_ins table ────────────────────────────────
    # No production data, no active code path. RLS policy must go first.
    op.execute("DROP POLICY IF EXISTS tenant_isolation_policy_check_ins ON check_ins")
    op.drop_table("check_ins")

    # ── Step B: rename ticket_events → check_ins ───────────────────────────
    op.rename_table("ticket_events", "check_ins")

    # ── Step C: rename associated objects to match new table name ──────────
    # Indexes
    op.execute(
        "ALTER INDEX IF EXISTS ix_ticket_events_attendee_product RENAME TO ix_check_ins_attendee_product"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_ticket_events_type_occurred RENAME TO ix_check_ins_occurred_at"
    )
    op.execute(
        "ALTER INDEX IF EXISTS ix_ticket_events_popup_id RENAME TO ix_check_ins_popup_id"
    )
    # Primary key constraint
    op.execute(
        "ALTER TABLE check_ins RENAME CONSTRAINT pk_ticket_events TO pk_check_ins"
    )
    # FK constraints
    op.execute(
        "ALTER TABLE check_ins RENAME CONSTRAINT fk_ticket_events_tenant_id TO fk_check_ins_tenant_id"
    )
    op.execute(
        "ALTER TABLE check_ins RENAME CONSTRAINT fk_ticket_events_attendee_product_id TO fk_check_ins_attendee_product_id"
    )
    op.execute(
        "ALTER TABLE check_ins RENAME CONSTRAINT fk_ticket_events_actor_user_id TO fk_check_ins_actor_user_id"
    )
    op.execute(
        "ALTER TABLE check_ins RENAME CONSTRAINT fk_ticket_events_popup_id TO fk_check_ins_popup_id"
    )
    # RLS policy
    op.execute(
        "ALTER POLICY tenant_isolation_policy_ticket_events ON check_ins RENAME TO tenant_isolation_policy_check_ins"
    )

    # ── Step D: drop event_type column ─────────────────────────────────────
    # Index over (event_type, occurred_at) was renamed in Step C; we now
    # need a clean occurred_at-only index. The renamed index still exists
    # but covers the old composite — drop and recreate.
    op.drop_index("ix_check_ins_occurred_at", table_name="check_ins")
    op.drop_column("check_ins", "event_type")
    op.create_index(
        "ix_check_ins_occurred_at",
        "check_ins",
        ["occurred_at"],
    )


def downgrade() -> None:
    raise RuntimeError(
        "c5e9d3b2f8a0 (rename ticket_events to check_ins) is forward-only. "
        "Downgrade is not implemented — the legacy check_ins table cannot be "
        "restored, and reintroducing event_type would require backfilling "
        "every row with 'check_in'."
    )
