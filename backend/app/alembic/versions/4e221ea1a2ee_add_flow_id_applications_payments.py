"""add flow id to applications and payments

Design: sdd/sales-flows slice 4 — adds a nullable `sales_flow_id` FK+index
to `applications` and `payments`, backfilled to each popup's default
sales_flow (guaranteed to exist for every pre-existing popup by the slice-2
backfill migration, `4a983282b8aa`). No behavior reads this column yet:
`payments.sales_flow_id` is provenance only per design D7 (background /
reporting partitioning, never a request-path authorization or pricing
rule); `applications.sales_flow_id` is a plain column with no reader at
all in this slice. `uq_application_human_popup` is deliberately NOT
touched here — re-keying application uniqueness to
`(human_id, sales_flow_id)` is slice 5, gated behind human checkpoint G2.

Backfill is idempotent: the UPDATE only touches rows where
`sales_flow_id IS NULL`, so re-running this migration (or running it
after some other process already set the column) never overwrites an
already-resolved value — same idempotency shape as the slice-2 backfill.

Asserts a coverage invariant before returning: after the backfill, zero
`applications`/`payments` rows may have `sales_flow_id IS NULL` while their
owning popup has a default sales_flow. A violation raises `RuntimeError`
and rolls back the whole migration transaction (mirrors
`4a983282b8aa_backfill_default_sales_flows.py`'s own invariant check). Rows
whose popup genuinely has no default flow are left NULL — that state is
a slice-2 invariant violation, not something this migration can fix.

Downgrade drops the columns (with their FK and index) cleanly: unlike the
slice-2 backfill, nothing else references `sales_flow_id` yet, so there is
no orphan risk and this migration is fully reversible.

Revision ID: 4e221ea1a2ee
Revises: 4a983282b8aa
Create Date: 2026-08-03
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "4e221ea1a2ee"
down_revision = "4a983282b8aa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "applications",
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )

    op.create_foreign_key(
        "fk_applications_sales_flow_id",
        "applications",
        "sales_flows",
        ["sales_flow_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_payments_sales_flow_id",
        "payments",
        "sales_flows",
        ["sales_flow_id"],
        ["id"],
    )

    op.create_index("ix_applications_sales_flow_id", "applications", ["sales_flow_id"])
    op.create_index("ix_payments_sales_flow_id", "payments", ["sales_flow_id"])

    # Idempotent backfill: only rows without a sales_flow_id yet are touched.
    conn.execute(
        sa.text(
            "UPDATE applications a SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = a.popup_id AND f.is_default = true "
            "AND a.sales_flow_id IS NULL"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE payments p SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = p.popup_id AND f.is_default = true "
            "AND p.sales_flow_id IS NULL"
        )
    )

    # Coverage invariant: every row whose popup has a default flow must now
    # carry that flow's id. A violation aborts the whole migration.
    missing_applications = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM applications a "
            "JOIN sales_flows f ON f.popup_id = a.popup_id AND f.is_default = true "
            "WHERE a.sales_flow_id IS NULL"
        )
    ).scalar()
    if missing_applications:
        raise RuntimeError(
            "add_flow_id_applications_payments invariant violated: "
            f"{missing_applications} application(s) missing sales_flow_id "
            "despite their popup having a default sales_flow"
        )

    missing_payments = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM payments p "
            "JOIN sales_flows f ON f.popup_id = p.popup_id AND f.is_default = true "
            "WHERE p.sales_flow_id IS NULL"
        )
    ).scalar()
    if missing_payments:
        raise RuntimeError(
            "add_flow_id_applications_payments invariant violated: "
            f"{missing_payments} payment(s) missing sales_flow_id "
            "despite their popup having a default sales_flow"
        )


def downgrade() -> None:
    op.drop_index("ix_payments_sales_flow_id", table_name="payments")
    op.drop_constraint("fk_payments_sales_flow_id", "payments", type_="foreignkey")
    op.drop_column("payments", "sales_flow_id")

    op.drop_index("ix_applications_sales_flow_id", table_name="applications")
    op.drop_constraint(
        "fk_applications_sales_flow_id", "applications", type_="foreignkey"
    )
    op.drop_column("applications", "sales_flow_id")
