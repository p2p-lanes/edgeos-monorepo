"""Expand attendee products for nullable-recipient operational units.

Revision ID: b7d3e1f8c2a4
Revises: a6f4c8d2e9b1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7d3e1f8c2a4"
down_revision: str | Sequence[str] | None = "a6f4c8d2e9b1"
branch_labels = depends_on = None


def _backfill(bind: sa.Connection) -> None:
    paid = bind.execute(
        sa.text("""
        UPDATE attendee_products unit
        SET product_category_snapshot = line.product_category
        FROM payment_products line
        WHERE unit.payment_product_id = line.id
          AND unit.product_id = line.product_id
          AND unit.product_category_snapshot IS NULL
        """)
    ).rowcount
    manual = bind.execute(
        sa.text("""
        UPDATE attendee_products unit
        SET product_category_snapshot = product.category
        FROM products product
        WHERE unit.payment_product_id IS NULL
          AND unit.product_id = product.id
          AND unit.fulfillment_type = 'access'
          AND lower(product.category) = 'ticket'
          AND unit.product_category_snapshot IS NULL
        """)
    ).rowcount
    bind.execute(
        sa.text("""
        UPDATE payment_products line
        SET requires_check_in_snapshot = product.requires_check_in
        FROM products product
        WHERE line.product_id = product.id
          AND line.requires_check_in_snapshot IS NULL
        """)
    )
    bind.execute(
        sa.text("""
        UPDATE attendee_products unit
        SET requires_check_in_snapshot = product.requires_check_in
        FROM products product
        WHERE unit.product_id = product.id
          AND unit.requires_check_in_snapshot IS NULL
        """)
    )
    unresolved, conflicts = bind.execute(
        sa.text("""
        SELECT
          count(*) FILTER (WHERE unit.product_category_snapshot IS NULL),
          count(*) FILTER (
            WHERE line.id IS NOT NULL AND line.product_id <> unit.product_id)
        FROM attendee_products unit
        LEFT JOIN payment_products line ON line.id = unit.payment_product_id
        """)
    ).one()
    print(  # noqa: T201
        f"[{revision}] product unit backfill report: paid={paid}, manual={manual}, "
        f"unresolved={unresolved}, conflicts={conflicts}"
    )


def upgrade() -> None:
    op.alter_column("attendee_products", "attendee_id", nullable=True)
    op.add_column(
        "attendee_products", sa.Column("product_category_snapshot", sa.String())
    )
    op.add_column(
        "attendee_products", sa.Column("requires_check_in_snapshot", sa.Boolean())
    )
    op.add_column(
        "attendee_products", sa.Column("revoked_at", sa.DateTime(timezone=True))
    )
    op.add_column(
        "payment_products", sa.Column("requires_check_in_snapshot", sa.Boolean())
    )
    _backfill(op.get_bind())
    op.create_check_constraint(
        "ck_attendee_product_owner_or_lineage",
        "attendee_products",
        "attendee_id IS NOT NULL OR payment_product_id IS NOT NULL",
    )
    op.create_index(
        "ix_attendee_products_active_attendee_category",
        "attendee_products",
        ["attendee_id", "product_category_snapshot"],
        postgresql_where=sa.text("revoked_at IS NULL AND attendee_id IS NOT NULL"),
    )
    op.create_index(
        "ix_attendee_products_active_scannable",
        "attendee_products",
        ["check_in_code"],
        postgresql_where=sa.text(
            "revoked_at IS NULL AND requires_check_in_snapshot IS TRUE"
        ),
    )


def downgrade() -> None:
    attendee_less, revoked = (
        op.get_bind()
        .execute(
            sa.text("""
        SELECT count(*) FILTER (WHERE attendee_id IS NULL),
               count(*) FILTER (WHERE revoked_at IS NOT NULL)
        FROM attendee_products
        """)
        )
        .one()
    )
    if attendee_less or revoked:
        raise RuntimeError(
            "Cannot downgrade product-unit expansion: "
            f"attendee_less={attendee_less}, revoked={revoked}"
        )
    op.drop_index(
        "ix_attendee_products_active_scannable", table_name="attendee_products"
    )
    op.drop_index(
        "ix_attendee_products_active_attendee_category",
        table_name="attendee_products",
    )
    op.drop_constraint(
        "ck_attendee_product_owner_or_lineage", "attendee_products", type_="check"
    )
    op.drop_column("payment_products", "requires_check_in_snapshot")
    for column in (
        "revoked_at",
        "requires_check_in_snapshot",
        "product_category_snapshot",
    ):
        op.drop_column("attendee_products", column)
    op.alter_column("attendee_products", "attendee_id", nullable=False)
