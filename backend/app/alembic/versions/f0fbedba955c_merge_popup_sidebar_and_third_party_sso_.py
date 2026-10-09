"""Merge popup sidebar and third-party SSO migration heads."""

from collections.abc import Sequence

revision: str = "f0fbedba955c"
down_revision: tuple[str, str] = ("b2f8c4d1a6e9", "b5e7a9c1d3f2")
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
