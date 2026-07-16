"""Add per-popup SimpleFi success redirect behavior.

Forwarded to SimpleFi as ``redirect_urls.success_behavior`` on every payment
created for the popup. ``manual`` (SimpleFi's default) keeps the buyer on
SimpleFi's checkout until they click through to the success URL;
``automatic`` redirects immediately after approval.

Revision ID: a8e3d7f4c2b9
Revises: fa4a726d54b8
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8e3d7f4c2b9"
down_revision: str | Sequence[str] | None = "fa4a726d54b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "simplefi_success_behavior",
            sa.String(),
            nullable=False,
            server_default="manual",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "simplefi_success_behavior")
