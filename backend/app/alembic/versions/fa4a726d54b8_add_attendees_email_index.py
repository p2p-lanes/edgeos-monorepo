"""add attendees email index

Email is a hot filter column (attendee lookup by email in BO and check-in
flows) but was never indexed. ix_attendees_application_id already exists
from the initial schema (inline index=True), so only email is added here.

Revision ID: fa4a726d54b8
Revises: 849f058ee25f
Create Date: 2026-07-08 17:03:01.147145

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "fa4a726d54b8"
down_revision = "849f058ee25f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_attendees_email", "attendees", ["email"])


def downgrade() -> None:
    op.drop_index("ix_attendees_email", table_name="attendees")
