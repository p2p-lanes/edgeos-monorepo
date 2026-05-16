"""Step meta + popup favicon: ticketingsteps.emoji, ticketingsteps.show_in_navbar, popups.favicon_url.

Three additive columns, all opt-in and backwards-compatible:

* ``ticketingsteps.emoji`` — optional emoji string (max 8 chars) rendered
  in place of the default Lucide icon in the checkout step nav. ``NULL``
  keeps the legacy icon.
* ``ticketingsteps.show_in_navbar`` — whether the step appears in the top
  section nav. ``True`` (server default) preserves current behaviour for
  every existing step; tenants opt informational steps out as needed.
* ``popups.favicon_url`` — URL of the favicon shown on the checkout page.
  ``NULL`` falls back to the tenant default.

Revision ID: a3f72c1d9b0e
Revises: f7fa8db4239a
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3f72c1d9b0e"
down_revision: str | Sequence[str] | None = "f7fa8db4239a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ticketingsteps",
        sa.Column("emoji", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "ticketingsteps",
        sa.Column(
            "show_in_navbar",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column("favicon_url", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("popups", "favicon_url")
    op.drop_column("ticketingsteps", "show_in_navbar")
    op.drop_column("ticketingsteps", "emoji")
