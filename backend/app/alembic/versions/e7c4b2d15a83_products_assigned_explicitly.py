"""assign every product to its popup's default flow

Design: sdd/sales-flows-rediseno slice 4, R6 — a product sells in a flow
because it was assigned to it, never because nobody assigned it anywhere.

The shipped D3 rule read "assigned to no flow means available in EVERY
flow". That rule is not in the original considerations doc; it was invented
alongside the read-time fallbacks, and it has the same shape: an absent row
silently means "everywhere". It also makes assignment feel destructive —
assigning a product to one flow removes it from all the others, without
saying so.

This migration is the data half. Every product gets an explicit
`flow_products` row for its popup's default flow, so removing the rule in
the same slice changes nothing for a popup whose only flow is the default
one. Assignment and rule removal ship together on purpose: either alone is
a silent behavior change, and together they verify each other.

Scope: ALL products of the popup, including inactive and soft-deleted ones.
Availability is filtered by `is_active`/`deleted_at` upstream, so assigning
them costs nothing and keeps the invariant uniform — "every product is
assigned somewhere" is checkable without carving out exceptions.

Stock is untouched. It lives on the product, and flows that share a product
share its stock, exactly as the original doc decided.

`flow_products.product_id` also gains ON DELETE CASCADE. Assignments are
metadata about a product, not something worth outliving it: without the
cascade a hard delete fails on the FK, which is a foot-gun that only shows
up once assignments actually exist. Soft deletes (`deleted_at`) are
unaffected either way.

Idempotent: rows already present are skipped, so re-running is a no-op.

Downgrade deletes only the rows this migration would create — a product
assigned to its popup's default flow — leaving assignments to any other
flow alone. That restores the pre-slice state for a single-flow popup while
never discarding a deliberate assignment.

Revision ID: e7c4b2d15a83
Revises: d3f6b2a81c95
Create Date: 2026-08-06 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e7c4b2d15a83"
down_revision = "d3f6b2a81c95"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    op.drop_constraint(
        "flow_products_product_id_fkey", "flow_products", type_="foreignkey"
    )
    op.create_foreign_key(
        "flow_products_product_id_fkey",
        "flow_products",
        "products",
        ["product_id"],
        ["id"],
        ondelete="CASCADE",
    )

    conn.execute(
        sa.text(
            "INSERT INTO flow_products (tenant_id, flow_id, product_id) "
            "SELECT p.tenant_id, f.id, p.id "
            "FROM products p "
            "JOIN sales_flows f "
            "  ON f.popup_id = p.popup_id AND f.is_default = true "
            "ON CONFLICT (flow_id, product_id) DO NOTHING"
        )
    )

    # Every product whose popup has a default flow must now be assigned
    # somewhere. One left behind would silently stop selling the moment the
    # "unassigned means everywhere" rule is removed in this same slice.
    unassigned = conn.execute(
        sa.text(
            "SELECT p.id FROM products p "
            "JOIN sales_flows f "
            "  ON f.popup_id = p.popup_id AND f.is_default = true "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM flow_products fp WHERE fp.product_id = p.id"
            ") LIMIT 10"
        )
    ).all()
    if unassigned:
        ids = ", ".join(str(row[0]) for row in unassigned)
        raise RuntimeError(
            "products_assigned_explicitly invariant violated: products left "
            f"with no flow assignment (first ids: {ids})"
        )


def downgrade() -> None:
    op.drop_constraint(
        "flow_products_product_id_fkey", "flow_products", type_="foreignkey"
    )
    op.create_foreign_key(
        "flow_products_product_id_fkey",
        "flow_products",
        "products",
        ["product_id"],
        ["id"],
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM flow_products fp "
            "USING sales_flows f, products p "
            "WHERE fp.flow_id = f.id "
            "  AND fp.product_id = p.id "
            "  AND f.is_default = true "
            "  AND f.popup_id = p.popup_id"
        )
    )
