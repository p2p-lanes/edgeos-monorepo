"""attendee_products_checkin_pass_sent_at: idempotency stamp for check-in pass.

Adds:
  - attendee_products.checkin_pass_sent_at (timestamptz, NULL)

Set by the check-in pass cron dispatcher after a successful send so repeated
cron runs (or overlapping replicas) don't re-email the same ticket. NULL means
the pass has not been sent yet.

Revision ID: c3f8a2d6e1b4
Revises: b2e9f4a1c7d3
Create Date: 2026-05-26 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f8a2d6e1b4"
down_revision: str = "b2e9f4a1c7d3"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "attendee_products",
        sa.Column("checkin_pass_sent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("attendee_products", "checkin_pass_sent_at")
