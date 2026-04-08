"""Add optional custom label column to basefieldconfigs.

Allows per-popup display label overrides for protected base fields.
NULL means use the hardcoded default from BASE_FIELD_DEFINITIONS.

Revision ID: 0021_basefield_label
Revises: 0020_scholarship_section
Create Date: 2026-03-26

"""

import sqlalchemy as sa
from alembic import op

revision = "0021_basefield_label"
down_revision = "0020_scholarship_section"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "basefieldconfigs",
        sa.Column("label", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_column("basefieldconfigs", "label")
