"""merge self_check_in + attendee_directory

Revision ID: 0d62c955bfdf
Revises: 6b8d4f2a9c1e, 6c1d2e3f4a5b
Create Date: 2026-05-13
"""

from collections.abc import Sequence

revision: str = "0d62c955bfdf"
down_revision: tuple[str, str] = ("6b8d4f2a9c1e", "6c1d2e3f4a5b")
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
