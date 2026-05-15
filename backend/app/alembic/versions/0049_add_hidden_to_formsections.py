"""Add hidden column to formsections.

A hidden section keeps its fields and data but is not surfaced on the
portal application form. Admins use this to switch off built-in sections
(e.g. "Info not shared") that they don't want to ask in a particular
popup, without losing the section configuration.

Revision ID: 0049_hidden_formsections
Revises: 0036_event_kinds_no_amenities
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0049_hidden_formsections"
down_revision = "0036_event_kinds_no_amenities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'formsections' AND column_name = 'hidden'"
        )
    )
    if not result.fetchone():
        op.add_column(
            "formsections",
            sa.Column("hidden", sa.Boolean(), nullable=False, server_default="false"),
        )


def downgrade() -> None:
    op.drop_column("formsections", "hidden")
