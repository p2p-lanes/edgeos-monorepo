"""Add portal visibility flag to popups.

Revision ID: f4b7c9d2e6a1
Revises: e2c6a91b7d4f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4b7c9d2e6a1"
down_revision: str = "e2c6a91b7d4f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "visible_in_portal",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "visible_in_portal")
