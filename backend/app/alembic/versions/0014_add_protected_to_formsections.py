"""Add protected column to formsections

Revision ID: 0014_add_protected_to_formsections
Revises: 0013_add_base_field_configs
Create Date: 2026-03-04

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0014_protected_formsections"
down_revision = "0013_add_base_field_configs"
branch_labels = None
depends_on = None

DEFAULT_SECTION_LABELS = ["Profile", "Info not shared"]


def upgrade():
    # Add protected column (idempotent: skip if already exists from local dev)
    conn = op.get_bind()
    result = conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'formsections' AND column_name = 'protected'"
        )
    )
    if not result.fetchone():
        op.add_column(
            "formsections",
            sa.Column("protected", sa.Boolean(), nullable=False, server_default="false"),
        )

    # Mark default base-field sections as protected
    conn.execute(
        sa.text(
            "UPDATE formsections SET protected = true "
            "WHERE label = ANY(:labels) AND protected = false"
        ),
        {"labels": DEFAULT_SECTION_LABELS},
    )


def downgrade():
    op.drop_column("formsections", "protected")
