"""Promote AttendeeProducts to first-class Ticket entity.

Revision ID: 0044_ticket_as_first_class_entity
Revises: 0043_tenant_scoped_popup_slug
Create Date: 2026-05-06

Forward-only migration (no downgrade). Raises RuntimeError if downgrade is attempted.

Steps:
  A. Add new columns (nullable first so existing rows get defaults)
  B. Backfill check_in_codes via Python explosion loop for quantity>1 rows;
     backfill payment_id from latest APPROVED payment
  C. First-row inherits Attendees.check_in_code
  D. Restructure attendee_products (new PK, unique index, drop quantity)
  E. Restructure payment_products (new UUID PK, payment_id index)
  F. Make attendees.check_in_code NULLABLE
  G. Partial unique index on attendees (human_id, popup_id) WHERE application_id IS NULL
  H. Add products.requires_check_in bool column + backfill
"""

import random
import string
import uuid

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic
revision = "0044_ticket_entity"
down_revision = "0043_tenant_scoped_popup_slug"
branch_labels = None
depends_on = None


def _generate_check_in_code(prefix: str = "") -> str:
    """Self-contained code generator (mirrors attendee/crud.generate_check_in_code).

    Migration is self-contained — does NOT import from app code to avoid coupling.
    Produces prefix + 8 random uppercase letters (26^8 ~= 208 billion combinations).
    """
    code = "".join(random.choices(string.ascii_uppercase, k=8))
    return f"{prefix}{code}"


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Guard: ensure pgcrypto is available for gen_random_uuid()
    # ------------------------------------------------------------------
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ------------------------------------------------------------------
    # Step A — Add new columns to attendee_products and payment_products
    #          (nullable first; server_default backfills existing rows)
    # ------------------------------------------------------------------
    op.add_column(
        "attendee_products",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
    )
    op.add_column(
        "attendee_products",
        sa.Column("check_in_code", sa.String(), nullable=True),
    )
    op.add_column(
        "attendee_products",
        sa.Column(
            "payment_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_attendee_products_payment_id",
        "attendee_products",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.add_column(
        "payment_products",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
    )

    # ------------------------------------------------------------------
    # Step B — Backfill
    # ------------------------------------------------------------------
    conn = op.get_bind()

    # B.1 — Explode quantity > 1 rows into individual ticket rows
    rows_to_explode = conn.execute(
        sa.text(
            "SELECT id, attendee_id, product_id, tenant_id, quantity "
            "FROM attendee_products WHERE quantity > 1"
        )
    ).fetchall()

    for row in rows_to_explode:
        extra_count = row.quantity - 1
        for _ in range(extra_count):
            conn.execute(
                sa.text(
                    "INSERT INTO attendee_products "
                    "(id, attendee_id, product_id, tenant_id, check_in_code) "
                    "VALUES (:id, :aid, :pid, :tid, :code)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "aid": str(row.attendee_id),
                    "pid": str(row.product_id),
                    "tid": str(row.tenant_id),
                    "code": _generate_check_in_code(""),
                },
            )

    # After explosion, every row represents one ticket
    conn.execute(sa.text("UPDATE attendee_products SET quantity = 1"))

    # B.2 — Backfill payment_id from latest APPROVED payment
    conn.execute(
        sa.text(
            """
            UPDATE attendee_products ap
            SET payment_id = pp.payment_id
            FROM (
                SELECT DISTINCT ON (pp.attendee_id, pp.product_id)
                    pp.attendee_id, pp.product_id, pp.payment_id
                FROM payment_products pp
                JOIN payments p ON pp.payment_id = p.id
                WHERE p.status = 'approved'
                ORDER BY pp.attendee_id, pp.product_id, p.created_at DESC
            ) pp
            WHERE ap.attendee_id = pp.attendee_id
              AND ap.product_id  = pp.product_id
            """
        )
    )

    # ------------------------------------------------------------------
    # Step C — First exploded row inherits Attendees.check_in_code
    # ------------------------------------------------------------------

    # Assign freshly generated codes to all rows that still have NULL check_in_code
    # We do this in Python to use the consistent code generator
    null_code_rows = conn.execute(
        sa.text("SELECT id FROM attendee_products WHERE check_in_code IS NULL")
    ).fetchall()

    for row in null_code_rows:
        conn.execute(
            sa.text(
                "UPDATE attendee_products SET check_in_code = :code WHERE id = :id"
            ),
            {"code": _generate_check_in_code(""), "id": str(row.id)},
        )

    # For each attendee with a legacy check_in_code, assign that code to
    # the FIRST ticket row (ordered by id) — preserving in-flight QRs
    conn.execute(
        sa.text(
            """
            UPDATE attendee_products ap
            SET check_in_code = a.check_in_code
            FROM attendees a
            WHERE ap.attendee_id = a.id
              AND ap.id = (
                  SELECT id FROM attendee_products
                  WHERE attendee_id = a.id
                  ORDER BY id LIMIT 1
              )
              AND a.check_in_code IS NOT NULL
              AND a.check_in_code != ''
            """
        )
    )

    # ------------------------------------------------------------------
    # Step D — Restructure attendee_products
    #          Drop old composite PK → new UUID PK → unique index on code
    # ------------------------------------------------------------------
    op.drop_constraint("attendee_products_pkey", "attendee_products", type_="primary")
    op.create_primary_key("pk_attendee_products", "attendee_products", ["id"])

    # Now that PK is id, enforce check_in_code NOT NULL
    op.alter_column("attendee_products", "check_in_code", nullable=False)

    op.create_index(
        "ux_attendee_products_check_in_code",
        "attendee_products",
        ["check_in_code"],
        unique=True,
    )
    op.create_index(
        "ix_attendee_products_payment_id",
        "attendee_products",
        ["payment_id"],
    )

    # Drop quantity column
    op.drop_column("attendee_products", "quantity")

    # ------------------------------------------------------------------
    # Step E — Restructure payment_products
    #          Drop old composite PK → new UUID PK
    # ------------------------------------------------------------------
    op.drop_constraint("payment_products_pkey", "payment_products", type_="primary")
    op.create_primary_key("pk_payment_products", "payment_products", ["id"])

    op.create_index(
        "ix_payment_products_payment_id",
        "payment_products",
        ["payment_id"],
    )

    # ------------------------------------------------------------------
    # Step F — attendees.check_in_code becomes NULLABLE
    # ------------------------------------------------------------------
    op.alter_column("attendees", "check_in_code", nullable=True)

    # ------------------------------------------------------------------
    # Step G — Partial unique index on attendees (direct-sale uniqueness)
    # ------------------------------------------------------------------
    op.create_index(
        "ux_attendees_human_popup_direct",
        "attendees",
        ["human_id", "popup_id"],
        unique=True,
        postgresql_where=sa.text("application_id IS NULL"),
    )

    # ------------------------------------------------------------------
    # Step H — products.requires_check_in bool column + backfill
    # ------------------------------------------------------------------
    op.add_column(
        "products",
        sa.Column(
            "requires_check_in",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # Backfill: products with category='ticket' default to requires_check_in=true
    conn.execute(
        sa.text(
            "UPDATE products SET requires_check_in = true WHERE LOWER(category) = 'ticket'"
        )
    )


def downgrade() -> None:
    raise RuntimeError(
        "0044_ticket_as_first_class_entity is a forward-only migration. "
        "Downgrade is not implemented — collapsing per-ticket rows back to "
        "quantity aggregation would corrupt per-ticket identity."
    )
