"""Add recipient snapshots and deferred Attendee fulfillment lineage.

Revision ID: d9c7b4e2a1f8
Revises: 7a4e2f8c9d01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "d9c7b4e2a1f8"
down_revision: str | Sequence[str] | None = "7a4e2f8c9d01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill(bind: sa.Connection) -> None:
    """Populate only ownership and lineage supported by deterministic evidence."""
    bind.execute(
        sa.text("""
        UPDATE payments p
        SET buyer_human_id = a.human_id
        FROM applications a
        WHERE p.buyer_human_id IS NULL
          AND p.application_id = a.id;

        WITH unique_direct_buyer AS (
            SELECT pp.payment_id, (array_agg(DISTINCT a.human_id))[1] AS human_id
            FROM payment_products pp
            JOIN attendees a ON a.id = pp.attendee_id
            JOIN payments p ON p.id = pp.payment_id
            WHERE p.buyer_human_id IS NULL
              AND p.application_id IS NULL
              AND a.human_id IS NOT NULL
            GROUP BY pp.payment_id
            HAVING count(DISTINCT a.human_id) = 1
        )
        UPDATE payments p
        SET buyer_human_id = candidate.human_id
        FROM unique_direct_buyer candidate
        WHERE p.id = candidate.payment_id
          AND p.buyer_human_id IS NULL;

        UPDATE attendees attendee
        SET managed_by_human_id = application.human_id
        FROM applications application
        WHERE attendee.managed_by_human_id IS NULL
          AND attendee.application_id = application.id;

        WITH payment_lineage AS (
            SELECT attendee_id, payment_id
            FROM payment_products
            WHERE attendee_id IS NOT NULL
            UNION
            SELECT attendee_id, payment_id
            FROM attendee_products
            WHERE payment_id IS NOT NULL
        ), unique_manager AS (
            SELECT lineage.attendee_id,
                   (array_agg(DISTINCT payment.buyer_human_id))[1] AS human_id
            FROM payment_lineage lineage
            JOIN payments payment ON payment.id = lineage.payment_id
            GROUP BY lineage.attendee_id
            HAVING count(*) FILTER (WHERE payment.buyer_human_id IS NULL) = 0
               AND count(DISTINCT payment.buyer_human_id) = 1
        )
        UPDATE attendees attendee
        SET managed_by_human_id = candidate.human_id
        FROM unique_manager candidate
        WHERE attendee.id = candidate.attendee_id
          AND attendee.managed_by_human_id IS NULL;

        WITH single_line AS (
            SELECT payment_id, attendee_id, product_id,
                   (array_agg(id))[1] AS payment_product_id,
                   max(quantity) AS quantity
            FROM payment_products
            WHERE attendee_id IS NOT NULL
            GROUP BY payment_id, attendee_id, product_id
            HAVING count(*) = 1
        ), slots AS (
            SELECT line.*, unit_index,
                   row_number() OVER (
                       PARTITION BY payment_id, attendee_id, product_id
                       ORDER BY unit_index
                   ) AS slot_rank
            FROM single_line line
            CROSS JOIN LATERAL generate_series(0, line.quantity - 1) unit_index
        ), tickets AS (
            SELECT id, payment_id, attendee_id, product_id,
                   row_number() OVER (
                       PARTITION BY payment_id, attendee_id, product_id ORDER BY id
                   ) AS ticket_rank
            FROM attendee_products
            WHERE payment_id IS NOT NULL AND payment_product_id IS NULL
        )
        UPDATE attendee_products ticket
        SET payment_product_id = slot.payment_product_id,
            unit_index = slot.unit_index
        FROM tickets ranked
        JOIN slots slot
          ON slot.payment_id = ranked.payment_id
         AND slot.attendee_id = ranked.attendee_id
         AND slot.product_id = ranked.product_id
         AND slot.slot_rank = ranked.ticket_rank
        WHERE ticket.id = ranked.id;
    """)
    )

    counts = bind.execute(
        sa.text("""
        SELECT
            (SELECT count(*) FROM payments WHERE buyer_human_id IS NULL),
            (SELECT count(*) FROM attendees WHERE managed_by_human_id IS NULL),
            (SELECT count(*) FROM attendee_products
             WHERE payment_id IS NOT NULL AND payment_product_id IS NULL)
    """)
    ).one()
    print(  # noqa: T201 - migration reports intentionally unresolved rows
        "[d9c7b4e2a1f8] unresolved deterministic backfill counts: "
        f"payments={counts[0]}, attendees={counts[1]}, tickets={counts[2]}"
    )


def upgrade() -> None:
    op.add_column(
        "payments", sa.Column("buyer_human_id", postgresql.UUID(as_uuid=True))
    )
    op.create_foreign_key(
        "fk_payments_buyer_human_id", "payments", "humans", ["buyer_human_id"], ["id"]
    )
    op.create_index("ix_payments_buyer_human_id", "payments", ["buyer_human_id"])

    op.add_column(
        "attendees", sa.Column("managed_by_human_id", postgresql.UUID(as_uuid=True))
    )
    op.create_foreign_key(
        "fk_attendees_managed_by_human_id",
        "attendees",
        "humans",
        ["managed_by_human_id"],
        ["id"],
    )
    op.create_index(
        "ix_attendees_managed_by_human_id", "attendees", ["managed_by_human_id"]
    )

    op.create_table(
        "payment_recipients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("payment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipient_key", sa.String(255), nullable=False),
        sa.Column("human_id", postgresql.UUID(as_uuid=True)),
        sa.Column("existing_attendee_id", postgresql.UUID(as_uuid=True)),
        sa.Column("attendee_id", postgresql.UUID(as_uuid=True)),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String()),
        sa.Column("category_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "profile_snapshot",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"]),
        sa.ForeignKeyConstraint(["human_id"], ["humans.id"]),
        sa.ForeignKeyConstraint(["existing_attendee_id"], ["attendees.id"]),
        sa.ForeignKeyConstraint(["attendee_id"], ["attendees.id"]),
        sa.ForeignKeyConstraint(["category_id"], ["attendee_categories.id"]),
        sa.UniqueConstraint(
            "payment_id", "recipient_key", name="uq_payment_recipient_payment_key"
        ),
        sa.UniqueConstraint("id", "payment_id", name="uq_payment_recipient_id_payment"),
        sa.CheckConstraint(
            "recipient_key <> ''", name="ck_payment_recipient_key_nonempty"
        ),
    )
    for column in ("tenant_id", "human_id", "existing_attendee_id", "attendee_id"):
        op.create_index(
            f"ix_payment_recipients_{column}", "payment_recipients", [column]
        )
    add_tenant_table_permissions("payment_recipients")

    op.add_column(
        "payment_products",
        sa.Column("payment_recipient_id", postgresql.UUID(as_uuid=True)),
    )
    op.create_foreign_key(
        "fk_payment_product_recipient_payment",
        "payment_products",
        "payment_recipients",
        ["payment_recipient_id", "payment_id"],
        ["id", "payment_id"],
    )
    op.create_index(
        "ix_payment_products_payment_recipient_id",
        "payment_products",
        ["payment_recipient_id"],
    )
    op.alter_column("payment_products", "attendee_id", nullable=True)
    op.create_check_constraint(
        "ck_payment_product_has_recipient_or_attendee",
        "payment_products",
        "payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL",
    )

    op.add_column(
        "attendee_products",
        sa.Column("payment_product_id", postgresql.UUID(as_uuid=True)),
    )
    op.add_column("attendee_products", sa.Column("unit_index", sa.Integer()))
    op.create_foreign_key(
        "fk_attendee_products_payment_product_id",
        "attendee_products",
        "payment_products",
        ["payment_product_id"],
        ["id"],
    )
    op.create_check_constraint(
        "ck_attendee_product_lineage_pair",
        "attendee_products",
        "(payment_product_id IS NULL) = (unit_index IS NULL)",
    )
    op.create_check_constraint(
        "ck_attendee_product_unit_index_nonnegative",
        "attendee_products",
        "unit_index IS NULL OR unit_index >= 0",
    )
    op.create_index(
        "ux_attendee_product_payment_product_unit",
        "attendee_products",
        ["payment_product_id", "unit_index"],
        unique=True,
        postgresql_where=sa.text("payment_product_id IS NOT NULL"),
    )
    _backfill(op.get_bind())


def downgrade() -> None:
    op.drop_index(
        "ux_attendee_product_payment_product_unit", table_name="attendee_products"
    )
    op.drop_constraint(
        "ck_attendee_product_unit_index_nonnegative", "attendee_products", type_="check"
    )
    op.drop_constraint(
        "ck_attendee_product_lineage_pair", "attendee_products", type_="check"
    )
    op.drop_constraint(
        "fk_attendee_products_payment_product_id",
        "attendee_products",
        type_="foreignkey",
    )
    op.drop_column("attendee_products", "unit_index")
    op.drop_column("attendee_products", "payment_product_id")
    op.drop_constraint(
        "ck_payment_product_has_recipient_or_attendee",
        "payment_products",
        type_="check",
    )
    op.alter_column("payment_products", "attendee_id", nullable=False)
    op.drop_index(
        "ix_payment_products_payment_recipient_id", table_name="payment_products"
    )
    op.drop_constraint(
        "fk_payment_product_recipient_payment",
        "payment_products",
        type_="foreignkey",
    )
    op.drop_column("payment_products", "payment_recipient_id")
    remove_tenant_table_permissions("payment_recipients")
    op.drop_table("payment_recipients")
    op.drop_index("ix_attendees_managed_by_human_id", table_name="attendees")
    op.drop_constraint(
        "fk_attendees_managed_by_human_id", "attendees", type_="foreignkey"
    )
    op.drop_column("attendees", "managed_by_human_id")
    op.drop_index("ix_payments_buyer_human_id", table_name="payments")
    op.drop_constraint("fk_payments_buyer_human_id", "payments", type_="foreignkey")
    op.drop_column("payments", "buyer_human_id")
