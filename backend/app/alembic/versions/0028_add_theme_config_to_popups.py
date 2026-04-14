"""Add theme_config JSONB column to popups.

Revision ID: 0028_add_theme_config
Revises: 0027_rename_to_template
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0028_add_theme_config"
down_revision = "0027_rename_to_template"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("popups", sa.Column("theme_config", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("popups", "theme_config")
