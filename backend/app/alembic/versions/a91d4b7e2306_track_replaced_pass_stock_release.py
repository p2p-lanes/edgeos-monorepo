"""Track stock released by portal pass replacements, without backfilling history."""

import sqlalchemy as sa
from alembic import op

revision = "a91d4b7e2306"
down_revision = "f6b2a9d1c804"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendee_products",
        sa.Column("stock_released_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("attendee_products", "stock_released_at")
