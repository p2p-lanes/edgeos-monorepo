"""Add optional per-popup custom home HTML.

Revision ID: d9e4c2a7b6f1
Revises: a4f1c8b2e7d3
"""

import sqlalchemy as sa
from alembic import op

revision = "d9e4c2a7b6f1"
down_revision = "a4f1c8b2e7d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "custom_home_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column("popups", sa.Column("custom_home_html", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("popups", "custom_home_html")
    op.drop_column("popups", "custom_home_enabled")
