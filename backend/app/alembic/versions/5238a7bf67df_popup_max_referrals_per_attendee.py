"""Add max_referrals_per_attendee to popups.

Revision ID: 5238a7bf67df
Revises: bfaabd563367
Create Date: 2026-06-16

Adds per-popup config for the 1-link-per-attendee referral limit.
null = unlimited; default = 10.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "5238a7bf67df"
down_revision = "bfaabd563367"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "max_referrals_per_attendee",
            sa.Integer(),
            nullable=True,
            server_default="10",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "max_referrals_per_attendee")
