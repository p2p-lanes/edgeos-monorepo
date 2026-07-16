"""Add sold_out_override flag to products.

Manual sold-out mark kept separate from total_stock_remaining so the
counter stays truthful and restore / cap-recompute flows are unaffected.

Revision ID: 5a73bd12eacb
Revises: c58bb16def73
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "5a73bd12eacb"
down_revision: str | Sequence[str] | None = "c58bb16def73"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "products",
        sa.Column(
            "sold_out_override",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("products", "sold_out_override")
