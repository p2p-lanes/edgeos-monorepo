"""backfill pending scholarship status

Revision ID: c4d8e6f1a2b3
Revises: fbebb0375ba9
Create Date: 2026-08-21 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c4d8e6f1a2b3"
down_revision = "fbebb0375ba9"
branch_labels = None
depends_on = None


def backfill_pending_scholarship_status(connection) -> None:
    """Set the initial status for scholarship requests created before the invariant."""
    connection.execute(
        sa.text(
            "UPDATE applications "
            "SET scholarship_status = 'pending' "
            "WHERE scholarship_request = true AND scholarship_status IS NULL"
        )
    )


def upgrade() -> None:
    backfill_pending_scholarship_status(op.get_bind())


def downgrade() -> None:
    pass
