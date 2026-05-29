"""event admin_notes

Adds nullable events.admin_notes (TEXT) — free-text internal notes visible and
editable only by backoffice staff (and portal users whose email matches a
backoffice account). Read/written exclusively via dedicated admin-notes
endpoints; never serialized into EventPublic.

Revision ID: d4b1e7a9c2f5
Revises: c3f8a2d6e1b4
Create Date: 2026-05-29
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d4b1e7a9c2f5"
down_revision = "c3f8a2d6e1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column("admin_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("events", "admin_notes")
