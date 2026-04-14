"""Add product_category and display_variant to ticketing steps; convert products.category to varchar.

Revision ID: 0025_custom_ticketing_steps
Revises: 0024_add_ticketing_steps
Create Date: 2026-03-19

"""

import sqlalchemy as sa
from alembic import op

revision = "0025_custom_ticketing_steps"
down_revision = "0024_add_ticketing_steps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add new columns to ticketingsteps
    op.add_column("ticketingsteps", sa.Column("product_category", sa.String(), nullable=True))
    op.add_column("ticketingsteps", sa.Column("display_variant", sa.String(), nullable=True))

    # Backfill product_category for the four default product-bearing steps
    op.execute("UPDATE ticketingsteps SET product_category = 'ticket'   WHERE step_type = 'tickets'")
    op.execute("UPDATE ticketingsteps SET product_category = 'housing'  WHERE step_type = 'housing'")
    op.execute("UPDATE ticketingsteps SET product_category = 'merch'    WHERE step_type = 'merch'")
    op.execute("UPDATE ticketingsteps SET product_category = 'patreon'  WHERE step_type = 'patron'")

    # Convert products.category from the enum type to varchar
    op.execute("ALTER TABLE products ALTER COLUMN category DROP DEFAULT")
    op.execute("ALTER TABLE products ALTER COLUMN category TYPE VARCHAR USING category::text")
    op.execute("ALTER TABLE products ALTER COLUMN category SET DEFAULT 'ticket'")
    op.execute("DROP TYPE IF EXISTS productcategory")


def downgrade() -> None:
    # Re-create the enum and revert the column (best-effort)
    op.execute(
        "CREATE TYPE productcategory AS ENUM ('ticket', 'housing', 'merch', 'other', 'patreon')"
    )
    op.execute(
        "ALTER TABLE products ALTER COLUMN category TYPE productcategory USING category::productcategory"
    )

    op.drop_column("ticketingsteps", "display_variant")
    op.drop_column("ticketingsteps", "product_category")
