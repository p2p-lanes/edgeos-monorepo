"""Add checked fulfillment classification and deterministic snapshots.

Revision ID: e4a7c2d9b1f6
Revises: d9c7b4e2a1f8
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e4a7c2d9b1f6"
down_revision: str | Sequence[str] | None = "d9c7b4e2a1f8"
branch_labels = depends_on = None

_ALLOWED = (
    "fulfillment_type IS NULL OR fulfillment_type IN ('access', 'participant', 'order')"
)
_IDENTITY_COMPATIBILITY = (
    "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
    "(fulfillment_type IN ('access', 'participant') AND "
    "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))"
)
_COMPATIBILITY_CONSTRAINT = "ck_payment_product_fulfillment_identity_compatibility"
_LEGACY_CONSTRAINT = "ck_payment_product_has_recipient_or_attendee"
_EVIDENCE = """
meal_products AS (
    SELECT DISTINCT product->>'product_id' AS product_id
    FROM ticketingsteps step
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(step.template_config->'sections') = 'array'
             THEN step.template_config->'sections' ELSE '[]'::jsonb END
    ) section
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(section->'products') = 'array'
             THEN section->'products' ELSE '[]'::jsonb END
    ) product
    WHERE step.template = 'meal-plan-select'
), product_evidence AS (
    SELECT product.id,
           lower(product.category) = 'ticket' AS is_access,
           coalesce(bool_or(meal.product_id = product.id::text), false)
             AS is_participant,
           lower(product.category) IN ('housing', 'merch', 'patreon') AS is_order
    FROM products product
    LEFT JOIN meal_products meal ON meal.product_id = product.id::text
    GROUP BY product.id
)
"""


def _backfill(bind: sa.Connection) -> dict[str, int]:
    """Classify only singular evidence, then preserve immutable snapshots."""
    bind.execute(
        sa.text(f"""
        WITH {_EVIDENCE}, classified AS (
            SELECT id,
                   CASE WHEN is_access THEN 'access'
                        WHEN is_participant THEN 'participant'
                        WHEN is_order THEN 'order' END AS fulfillment_type
            FROM product_evidence
            WHERE is_access::int + is_participant::int + is_order::int = 1
        )
        UPDATE products product
        SET fulfillment_type = classified.fulfillment_type
        FROM classified
        WHERE product.id = classified.id AND product.fulfillment_type IS NULL
        """)
    )
    bind.execute(
        sa.text("""
        UPDATE payment_products snapshot
        SET fulfillment_type = product.fulfillment_type
        FROM products product
        WHERE snapshot.product_id = product.id
          AND snapshot.fulfillment_type IS NULL
          AND product.fulfillment_type IS NOT NULL
        """)
    )
    bind.execute(
        sa.text("""
        WITH candidates AS (
            SELECT holding.id,
                   CASE
                     WHEN snapshot.id IS NOT NULL
                       AND snapshot.product_id <> holding.product_id THEN NULL
                     WHEN snapshot.fulfillment_type IS NOT NULL
                       AND product.fulfillment_type IS NOT NULL
                       AND snapshot.fulfillment_type <> product.fulfillment_type THEN NULL
                     ELSE coalesce(snapshot.fulfillment_type, product.fulfillment_type)
                   END AS fulfillment_type
            FROM attendee_products holding
            JOIN products product ON product.id = holding.product_id
            LEFT JOIN payment_products snapshot
              ON snapshot.id = holding.payment_product_id
        )
        UPDATE attendee_products holding
        SET fulfillment_type = candidates.fulfillment_type
        FROM candidates
        WHERE holding.id = candidates.id
          AND holding.fulfillment_type IS NULL
          AND candidates.fulfillment_type IN ('access', 'participant', 'order')
        """)
    )
    row = bind.execute(
        sa.text(f"""
        WITH {_EVIDENCE}, holding_conflicts AS (
            SELECT holding.id
            FROM attendee_products holding
            JOIN products product ON product.id = holding.product_id
            LEFT JOIN payment_products snapshot ON snapshot.id = holding.payment_product_id
            WHERE holding.fulfillment_type IS NULL AND (
              (snapshot.id IS NOT NULL AND snapshot.product_id <> holding.product_id)
              OR (snapshot.fulfillment_type IS NOT NULL
                  AND product.fulfillment_type IS NOT NULL
                  AND snapshot.fulfillment_type <> product.fulfillment_type)
            )
        )
        SELECT
          (SELECT count(*) FROM products WHERE fulfillment_type IS NULL),
          (SELECT count(*) FROM product_evidence
           WHERE is_access::int + is_participant::int + is_order::int > 1),
          (SELECT count(*) FROM payment_products WHERE fulfillment_type IS NULL),
          (SELECT count(*) FROM attendee_products WHERE fulfillment_type IS NULL),
          (SELECT count(*) FROM holding_conflicts)
        """)
    ).one()
    keys = (
        "products_unclassified",
        "product_conflicts",
        "payment_products_unclassified",
        "attendee_products_unclassified",
        "attendee_product_conflicts",
    )
    counts = dict(zip(keys, row, strict=True))
    values = ", ".join(f"{key}={value}" for key, value in counts.items())
    print(f"[{revision}] fulfillment backfill report: {values}")  # noqa: T201
    return counts


def upgrade() -> None:
    for table in ("products", "payment_products", "attendee_products"):
        op.add_column(table, sa.Column("fulfillment_type", sa.String(), nullable=True))
        op.create_check_constraint(f"ck_{table}_fulfillment_type", table, _ALLOWED)
    op.create_index("ix_products_fulfillment_type", "products", ["fulfillment_type"])
    op.create_index(
        "ix_payment_products_payment_fulfillment_type",
        "payment_products",
        ["payment_id", "fulfillment_type"],
    )
    op.create_index(
        "ix_attendee_products_attendee_fulfillment_type",
        "attendee_products",
        ["attendee_id", "fulfillment_type"],
    )
    _backfill(op.get_bind())
    op.drop_constraint(_LEGACY_CONSTRAINT, "payment_products", type_="check")
    op.create_check_constraint(
        _COMPATIBILITY_CONSTRAINT,
        "payment_products",
        _IDENTITY_COMPATIBILITY,
    )


def downgrade() -> None:
    # Restoring d9 requires every row to carry recipient or Attendee identity.
    # Identity-free order rows must be drained before this downgrade is attempted.
    op.drop_constraint(_COMPATIBILITY_CONSTRAINT, "payment_products", type_="check")
    op.create_check_constraint(
        _LEGACY_CONSTRAINT,
        "payment_products",
        "payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL",
    )
    op.drop_index(
        "ix_attendee_products_attendee_fulfillment_type",
        table_name="attendee_products",
    )
    op.drop_index(
        "ix_payment_products_payment_fulfillment_type", table_name="payment_products"
    )
    op.drop_index("ix_products_fulfillment_type", table_name="products")
    for table in ("attendee_products", "payment_products", "products"):
        op.drop_constraint(f"ck_{table}_fulfillment_type", table, type_="check")
        op.drop_column(table, "fulfillment_type")
