"""Add per-popup portal sidebar configuration.

Revision ID: b2f8c4d1a6e9
Revises: a4f6b8d2c9e1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "b2f8c4d1a6e9"
down_revision: str | None = "a4f6b8d2c9e1"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("popups", sa.Column("sidebar_config", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("popups", "sidebar_config")
