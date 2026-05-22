"""Merge: attendee_products payment_id backfill + payment_products metadata.

main shipped `4dffd7a49bef` (backfill attendee_products.payment_id) with
parent `f6c1f50160ef`. dev independently shipped `d2f5a7c891b3`
(payment_products.purchase_metadata) which also descends from
`f6c1f50160ef` via `a1f9c2e8b5d1` and `c0b101dd74e8`. When the backfill
PR was backported to dev, the two heads coexisted; this no-op merge joins
them so dev (and the eventual dev -> main merge) has a single head and
the file content of `4dffd7a49bef_*.py` stays identical to main.

Revision ID: 6b0327ae7ca7
Revises: 4dffd7a49bef, d2f5a7c891b3
"""

from collections.abc import Sequence

revision: str = "6b0327ae7ca7"
down_revision: tuple[str, ...] = ("4dffd7a49bef", "d2f5a7c891b3")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
