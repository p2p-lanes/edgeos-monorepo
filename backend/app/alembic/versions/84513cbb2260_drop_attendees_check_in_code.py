"""Drop attendees.check_in_code column.

Check-in codes belong to purchased tickets (attendee_products.check_in_code),
not to attendees. The attendee-level column was made nullable in
a51d7b0ab836 and stopped being populated for new rows. This migration drops
the column and its index entirely.

Revision ID: 84513cbb2260
Revises: 6b0327ae7ca7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "84513cbb2260"
down_revision: str | Sequence[str] | None = "6b0327ae7ca7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_attendees_check_in_code", table_name="attendees")
    op.drop_column("attendees", "check_in_code")


def downgrade() -> None:
    op.add_column(
        "attendees",
        sa.Column("check_in_code", sa.String(length=100), nullable=True),
    )
    op.create_index(
        "ix_attendees_check_in_code",
        "attendees",
        ["check_in_code"],
    )
