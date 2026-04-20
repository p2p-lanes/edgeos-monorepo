"""Add application_layout column to popups.

Lets each popup choose how the application form is rendered in the
portal: all sections stacked on one page (legacy), or one section per
step with Next/Back navigation.

Revision ID: e6a1d9b4c7f2
Revises: c3b8a7d5e9f1
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6a1d9b4c7f2"
down_revision: str = "c3b8a7d5e9f1"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "application_layout",
            sa.String(),
            nullable=False,
            server_default="single_page",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "application_layout")
