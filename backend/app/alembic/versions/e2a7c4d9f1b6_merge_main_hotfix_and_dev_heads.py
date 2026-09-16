"""merge main hotfix and dev heads

Revision ID: e2a7c4d9f1b6
Revises: d7c3a9e1f5b2, d9a7c2e4f1b8
Create Date: 2026-09-01 00:00:00.000000

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "e2a7c4d9f1b6"
down_revision: tuple[str, str] = ("d7c3a9e1f5b2", "d9a7c2e4f1b8")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
