"""Add show_title and show_watermark to ticketing_steps.

Revision ID: 0029_show_title_watermark
Revises: 0028_add_theme_config
"""

import sqlalchemy as sa
from alembic import op

revision = "0029_show_title_watermark"
down_revision = "0028_add_theme_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticketingsteps",
        sa.Column("show_title", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        "ticketingsteps",
        sa.Column("show_watermark", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("ticketingsteps", "show_watermark")
    op.drop_column("ticketingsteps", "show_title")
