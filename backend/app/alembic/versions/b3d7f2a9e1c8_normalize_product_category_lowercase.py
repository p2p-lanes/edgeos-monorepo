"""normalize_product_category_lowercase: lowercase products.category and drop legacy enum.

Migration 0005 converted products.category to a Postgres enum type
(productcategory) with UPPERCASE values to match Python enum names.
Commit d5ce564 later switched the Python schema back to a free-form `str`
with lowercase defaults but shipped NO accompanying data migration, so
existing rows still hold UPPERCASE values while new rows come in as
lowercase. This normalizes every existing row to lowercase, removes the
legacy enum type if still present, and aligns the server default to
"ticket".

Idempotent against two possible DB states:
  A. productcategory enum type still exists (column typed as enum)
  B. enum type already dropped manually (column already varchar/text)

Revision ID: b3d7f2a9e1c8
Revises: 1659fd142f0a
Create Date: 2026-04-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d7f2a9e1c8"
down_revision: str = "1659fd142f0a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    enum_exists = (
        conn.execute(
            sa.text("SELECT 1 FROM pg_type WHERE typname = 'productcategory'")
        ).scalar()
        is not None
    )

    if enum_exists:
        op.execute("ALTER TABLE products ALTER COLUMN category DROP DEFAULT")
        op.execute(
            """
            ALTER TABLE products
            ALTER COLUMN category TYPE VARCHAR(100)
            USING LOWER(category::text)
            """
        )
        op.execute("DROP TYPE productcategory")
    else:
        op.execute(
            """
            UPDATE products
            SET category = LOWER(category)
            WHERE category <> LOWER(category)
            """
        )

    op.alter_column(
        "products",
        "category",
        existing_type=sa.VARCHAR(length=100),
        server_default="ticket",
        existing_nullable=False,
    )


def downgrade() -> None:
    # Best-effort reversal: the Python schema is `str`, so uppercase values
    # remain valid at the app layer. We do NOT recreate the legacy enum type
    # because nothing in the current code references it.
    op.execute("UPDATE products SET category = UPPER(category)")
    op.alter_column(
        "products",
        "category",
        existing_type=sa.VARCHAR(length=100),
        server_default="TICKET",
        existing_nullable=False,
    )
