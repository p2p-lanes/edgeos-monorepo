"""Add per-popup open-checkout redirect URLs.

Lets an admin configure custom success / cancel URLs for the open-checkout
flow from the backoffice. When set, these override the derived portal
thank-you / cancel pages forwarded to SimpleFi as ``redirect_urls``; NULL
falls back to the existing portal URLs. Scope is the open-checkout flow only.

Revision ID: b3f7c1a9e2d4
Revises: 2a7c9e4f1b6d
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3f7c1a9e2d4"
down_revision: str | Sequence[str] | None = "2a7c9e4f1b6d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column("open_checkout_success_url", sa.String(), nullable=True),
    )
    op.add_column(
        "popups",
        sa.Column("open_checkout_cancel_url", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("popups", "open_checkout_cancel_url")
    op.drop_column("popups", "open_checkout_success_url")
