"""enforce referral auto approval

Revision ID: d9a7c2e4f1b8
Revises: c4d8e6f1a2b3
Create Date: 2026-09-01 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d9a7c2e4f1b8"
down_revision = "c4d8e6f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE invites SET auto_approve = true "
            "WHERE referrer_human_id IS NOT NULL AND auto_approve = false"
        )
    )
    op.create_check_constraint(
        "ck_invites_portal_auto_approve",
        "invites",
        "referrer_human_id IS NULL OR auto_approve",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_invites_portal_auto_approve",
        "invites",
        type_="check",
    )
