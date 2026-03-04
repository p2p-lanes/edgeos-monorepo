"""Add default_language and supported_languages columns to popups table

Revision ID: 0013_add_popup_language_fields
Revises: 0012_add_form_sections
Create Date: 2026-03-03

"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

from alembic import op

# revision identifiers, used by Alembic.
revision = "0013_add_popup_language_fields"
down_revision = "0012_add_form_sections"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "popups",
        sa.Column(
            "default_language",
            sa.String(),
            nullable=False,
            server_default="en",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "supported_languages",
            ARRAY(sa.String()),
            nullable=False,
            server_default="{en}",
        ),
    )


def downgrade():
    op.drop_column("popups", "supported_languages")
    op.drop_column("popups", "default_language")
