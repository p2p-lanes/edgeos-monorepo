"""merge form-section hidden + form-field width heads

Revision ID: merge_0049_8b4d5e6f
Revises: 0049_hidden_formsections, 8b4d5e6f7a2c
Create Date: 2026-05-15

"""

from collections.abc import Sequence

revision: str = "merge_0049_8b4d5e6f"
down_revision: tuple[str, str] = ("0049_hidden_formsections", "8b4d5e6f7a2c")
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
