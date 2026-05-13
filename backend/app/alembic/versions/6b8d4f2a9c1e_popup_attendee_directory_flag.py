"""Add attendee directory visibility flag to popups.

Revision ID: 6b8d4f2a9c1e
Revises: e111414d5736
Create Date: 2026-05-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "6b8d4f2a9c1e"
down_revision: str = "e111414d5736"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "show_attendee_directory",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "show_attendee_directory")
