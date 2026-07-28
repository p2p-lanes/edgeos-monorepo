"""Add portal help button config to tenants.

Revision ID: a7f2c9e4b183
Revises: 2b03f8cf7cdd
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a7f2c9e4b183"
down_revision: str | Sequence[str] | None = "2b03f8cf7cdd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Opt-in: existing tenants start with the help button off, so nobody
    # inherits it until an admin enables it and sets a destination address.
    op.add_column(
        "tenants",
        sa.Column(
            "help_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "tenants", sa.Column("help_email", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("tenants", "help_email")
    op.drop_column("tenants", "help_enabled")
