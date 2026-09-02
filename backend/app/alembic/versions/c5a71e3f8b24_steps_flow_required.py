"""ticketing steps belong to exactly one sales flow

Design: sdd/sales-flows-rediseno slice 2 — the schema half of replacing
read-time inheritance with real ownership. `b8e4c1d90a2f` gave every
existing step an owning flow; this migration makes that the only legal
shape.

`ticketingsteps.sales_flow_id` becomes NOT NULL, which retires the
popup-shared tier at the schema level: there is no longer any way to
express "a step that belongs to the popup but to no flow", so
`find_for_flow`'s fallback has nothing left to fall back to and is deleted
in the same slice.

The patron-preset singleton guard collapses with it. It was split across
two partial unique indexes keyed by tier:

  uq_ticketing_step_patron_flow          (sales_flow_id) WHERE ... IS NOT NULL
  uq_ticketing_step_patron_popup_shared  (popup_id)      WHERE ... IS NULL

The shared one can no longer match any row and is dropped. The flow one is
recreated without its now-redundant `sales_flow_id IS NOT NULL` clause, so
the invariant reads as what it actually is: one enabled patron step per
flow.

Guarded, not hopeful: an unowned step would be silently destroyed by
`SET NOT NULL`, so the count is checked first and a non-zero result aborts
the transaction with the offending ids. That can only happen if a popup
lacks a default flow (impossible per `4a983282b8aa`'s own invariant) or if
a writer inserted an unowned step between the two migrations.

Downgrade is real here — this is schema, not data. It restores the nullable
column and both original partial indexes. Rows keep their owning flow, so
downgrading yields a database where the shared tier is expressible again
but unused, which is exactly the pre-slice-2 state.

Revision ID: c5a71e3f8b24
Revises: b8e4c1d90a2f
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c5a71e3f8b24"
down_revision = "b8e4c1d90a2f"
branch_labels = None
depends_on = None

PATRON_FLOW_INDEX = "uq_ticketing_step_patron_flow"
PATRON_SHARED_INDEX = "uq_ticketing_step_patron_popup_shared"


def upgrade() -> None:
    conn = op.get_bind()

    unowned = conn.execute(
        sa.text("SELECT id FROM ticketingsteps WHERE sales_flow_id IS NULL LIMIT 10")
    ).all()
    if unowned:
        ids = ", ".join(str(row[0]) for row in unowned)
        raise RuntimeError(
            "steps_flow_required cannot proceed: ticketingsteps rows without a "
            f"sales_flow_id would be lost (first ids: {ids}). Run "
            "b8e4c1d90a2f (backfill_flow_config_ownership) first."
        )

    op.alter_column("ticketingsteps", "sales_flow_id", nullable=False)

    op.drop_index(PATRON_SHARED_INDEX, table_name="ticketingsteps")
    op.drop_index(PATRON_FLOW_INDEX, table_name="ticketingsteps")
    op.create_index(
        PATRON_FLOW_INDEX,
        "ticketingsteps",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("template = 'patron-preset' AND is_enabled = TRUE"),
    )


def downgrade() -> None:
    op.drop_index(PATRON_FLOW_INDEX, table_name="ticketingsteps")
    op.create_index(
        PATRON_FLOW_INDEX,
        "ticketingsteps",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text(
            "template = 'patron-preset' AND is_enabled = TRUE "
            "AND sales_flow_id IS NOT NULL"
        ),
    )
    op.create_index(
        PATRON_SHARED_INDEX,
        "ticketingsteps",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text(
            "template = 'patron-preset' AND is_enabled = TRUE AND sales_flow_id IS NULL"
        ),
    )

    op.alter_column("ticketingsteps", "sales_flow_id", nullable=True)
