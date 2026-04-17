"""merge heads

Revision ID: merge_0029_a1b2c3d4
Revises: 0029_show_title_watermark, a1b2c3d4e5f6
Create Date: 2026-04-14

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "merge_0029_a1b2c3d4"
down_revision: tuple[str, str] = ("0029_show_title_watermark", "a1b2c3d4e5f6")
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
