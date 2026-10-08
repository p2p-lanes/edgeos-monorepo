"""Default new public profile links to off.

Revision ID: a4f6b8d2c9e1
Revises: b3e8d1f5a2c7
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4f6b8d2c9e1"
down_revision: str = "b3e8d1f5a2c7"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Change only the insertion default; preserve existing sharing choices.
    op.alter_column(
        "humans",
        "public_profile_enabled",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.false(),
    )


def downgrade() -> None:
    op.alter_column(
        "humans",
        "public_profile_enabled",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        server_default=sa.true(),
    )
