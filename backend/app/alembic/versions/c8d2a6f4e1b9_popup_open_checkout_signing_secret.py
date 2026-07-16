"""Add per-popup open-checkout thank-you signing secret.

Holds the shared secret used to HMAC-sign the order payload appended to the
open-checkout success URL, so an external thank-you page can verify it.
Dedicated per popup — never the global SECRET_KEY. NULL means the success
redirect is sent without a signed payload.

Revision ID: c8d2a6f4e1b9
Revises: b3f7c1a9e2d4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d2a6f4e1b9"
down_revision: str | Sequence[str] | None = "b3f7c1a9e2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column("open_checkout_signing_secret", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("popups", "open_checkout_signing_secret")
