"""patron product rules

Adds effective_unit_price snapshot column to payment_products and two partial
unique indexes that enforce one patreon product per popup and one patron-preset
ticketing step per popup.

Revision ID: fb7da98c8d72
Revises: 42de2a61e52f
Create Date: 2026-05-14

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "fb7da98c8d72"
down_revision = "42de2a61e52f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add effective_unit_price snapshot column to payment_products.
    # NULL for non-patreon rows; set to unit_price_override for patreon rows.
    op.add_column(
        "payment_products",
        sa.Column(
            "effective_unit_price",
            sa.Numeric(10, 2),
            nullable=True,
        ),
    )

    # Partial unique index: at most one non-deleted patreon product per popup.
    op.create_index(
        "uq_product_patreon_per_popup",
        "products",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("category = 'patreon' AND deleted_at IS NULL"),
    )

    # Partial unique index: at most one enabled patron-preset ticketing step per popup.
    # The table name is ticketingsteps (SQLModel default for TicketingSteps class).
    # ticketingsteps has no deleted_at column, so we use is_enabled = TRUE.
    op.create_index(
        "uq_ticketing_step_patron_per_popup",
        "ticketingsteps",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("template = 'patron-preset' AND is_enabled = TRUE"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_ticketing_step_patron_per_popup",
        table_name="ticketingsteps",
    )
    op.drop_index(
        "uq_product_patreon_per_popup",
        table_name="products",
    )
    op.drop_column("payment_products", "effective_unit_price")
