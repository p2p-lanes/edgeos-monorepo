"""Add landing_mode column to tenants.

Adds a Postgres native ENUM column `landing_mode` to the `tenants` table,
defaulting to 'portal'. All existing tenants are implicitly set to 'portal'
via the server_default.

Revision ID: e111414d5736
Revises: 0047_event_host_display_name
Create Date: 2026-05-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e111414d5736"
down_revision: str = "0047_event_host_display_name"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_ENUM_NAME = "landingmode"


def upgrade() -> None:
    # Create the Postgres native ENUM type first
    landing_mode_enum = sa.Enum("portal", "checkout", name=_ENUM_NAME)
    landing_mode_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "tenants",
        sa.Column(
            "landing_mode",
            sa.Enum("portal", "checkout", name=_ENUM_NAME),
            nullable=False,
            server_default="portal",
        ),
    )


def downgrade() -> None:
    op.drop_column("tenants", "landing_mode")

    landing_mode_enum = sa.Enum("portal", "checkout", name=_ENUM_NAME)
    landing_mode_enum.drop(op.get_bind(), checkfirst=True)
