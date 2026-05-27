"""popup_checkin_pass_lead_days: scheduled check-in pass lead time on popups.

Adds:
  - popups.checkin_pass_lead_days (int, NULL)

Null disables the scheduled check-in pass email for the popup; a positive value
enables it and sets how many days before start_date to send. Read by the
check-in pass cron dispatcher. Content comes from the popup's custom
CHECK_IN_PASS email template, or the file-based default when none exists.

Revision ID: b2e9f4a1c7d3
Revises: 94d7d49c3c92
Create Date: 2026-05-26 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2e9f4a1c7d3"
down_revision: str = "94d7d49c3c92"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column("checkin_pass_lead_days", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("popups", "checkin_pass_lead_days")
