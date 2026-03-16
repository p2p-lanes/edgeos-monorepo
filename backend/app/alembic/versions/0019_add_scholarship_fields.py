"""Add scholarship fields to applications and popups.

Revision ID: 0019_scholarship
Revises: 38aafddc6982
Create Date: 2026-03-11

"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0019_scholarship"
down_revision = "38aafddc6982"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Applications: scholarship request fields (human-submitted)
    op.add_column(
        "applications",
        sa.Column("scholarship_request", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "applications",
        sa.Column("scholarship_details", sa.Text(), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column("scholarship_video_url", sa.String(), nullable=True),
    )

    # Applications: scholarship decision fields (admin-assigned)
    op.add_column(
        "applications",
        sa.Column("scholarship_status", sa.String(20), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column("discount_percentage", sa.Numeric(5, 2), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column("incentive_amount", sa.Numeric(12, 2), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column("incentive_currency", sa.String(10), nullable=True),
    )

    # Popups: scholarship feature flags
    op.add_column(
        "popups",
        sa.Column("allows_scholarship", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "popups",
        sa.Column("allows_incentive", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Partial index for filtering applications by scholarship status
    op.create_index(
        "ix_applications_scholarship_status",
        "applications",
        ["scholarship_status"],
        postgresql_where=sa.text("scholarship_status IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_applications_scholarship_status", table_name="applications")

    op.drop_column("popups", "allows_incentive")
    op.drop_column("popups", "allows_scholarship")

    op.drop_column("applications", "incentive_currency")
    op.drop_column("applications", "incentive_amount")
    op.drop_column("applications", "discount_percentage")
    op.drop_column("applications", "scholarship_status")
    op.drop_column("applications", "scholarship_video_url")
    op.drop_column("applications", "scholarship_details")
    op.drop_column("applications", "scholarship_request")
