"""Allow one attendee referral link per destination sales flow.

Revision ID: ea7c39d54f18
Revises: b4d8e1f27a93
"""

import sqlalchemy as sa
from alembic import op

revision = "ea7c39d54f18"
down_revision = "b4d8e1f27a93"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Prior to this migration the API allowed only one link per human/popup,
    # so existing rows cannot collide on the stricter per-flow identity.
    op.create_index(
        "uq_invites_referrer_flow",
        "invites",
        ["referrer_human_id", "sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("referrer_human_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_invites_referrer_flow", table_name="invites")
