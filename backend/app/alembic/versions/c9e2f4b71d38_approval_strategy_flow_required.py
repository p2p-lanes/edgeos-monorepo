"""an approval strategy belongs to exactly one sales flow

Design: sdd/sales-flows-rediseno slice 6 — the same cutover slices 2 and 3
did for steps and forms, applied to `approvalstrategies`.

`b8e4c1d90a2f` gave every existing strategy an owning flow. Making the
column NOT NULL retires the popup-shared tier at the schema level, so
`get_for_flow`'s fallback has nothing left to fall back to and is deleted
in the same slice.

The two partial unique indexes collapse into one. They were keyed by tier:

  uq_approval_strategy_flow          (sales_flow_id) WHERE ... IS NOT NULL
  uq_approval_strategy_popup_shared  (popup_id)      WHERE ... IS NULL

The shared half can no longer match a row and is dropped; the flow half is
recreated as a plain unique constraint, since its predicate is now implied
by the column. What the constraint says also gets truer: one approval
strategy per FLOW, so two application flows of the same popup can review
their applicants differently — which was the point of having flows.

Guarded: an unowned row would be silently destroyed by `SET NOT NULL`, so
the count is checked first and a non-zero result aborts the transaction
naming the offending ids.

Downgrade restores the nullable column and both original partial indexes.

Revision ID: c9e2f4b71d38
Revises: a1d5f83c26b4
Create Date: 2026-08-06 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c9e2f4b71d38"
down_revision = "a1d5f83c26b4"
branch_labels = None
depends_on = None

FLOW_INDEX = "uq_approval_strategy_flow"
SHARED_INDEX = "uq_approval_strategy_popup_shared"


def upgrade() -> None:
    conn = op.get_bind()

    unowned = conn.execute(
        sa.text(
            "SELECT id FROM approvalstrategies WHERE sales_flow_id IS NULL LIMIT 10"
        )
    ).all()
    if unowned:
        ids = ", ".join(str(row[0]) for row in unowned)
        raise RuntimeError(
            "approval_strategy_flow_required cannot proceed: approvalstrategies "
            f"rows without a sales_flow_id would be lost (first ids: {ids}). "
            "Run b8e4c1d90a2f (backfill_flow_config_ownership) first."
        )

    op.alter_column("approvalstrategies", "sales_flow_id", nullable=False)

    op.drop_index(SHARED_INDEX, table_name="approvalstrategies")
    op.drop_index(FLOW_INDEX, table_name="approvalstrategies")
    op.create_index(
        FLOW_INDEX, "approvalstrategies", ["sales_flow_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index(FLOW_INDEX, table_name="approvalstrategies")
    op.create_index(
        FLOW_INDEX,
        "approvalstrategies",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        SHARED_INDEX,
        "approvalstrategies",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    op.alter_column("approvalstrategies", "sales_flow_id", nullable=True)
