"""Add an optional info note to products.

Revision ID: 36cf5a3e5a12
Revises: fe720154706f

Short admin-written context the checkout reveals behind an info icon next to
the product name ("A passport will be requested for this product"). NULL
means no icon, which is every existing product.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "36cf5a3e5a12"
down_revision: str | None = "fe720154706f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("info_note", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "info_note")
