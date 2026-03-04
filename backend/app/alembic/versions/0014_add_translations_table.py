"""Add translations table for i18n support

Revision ID: 0014_add_translations_table
Revises: 0013_add_popup_language_fields
Create Date: 2026-03-03

"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op
from app.alembic.utils import add_tenant_table_permissions, remove_tenant_table_permissions

# revision identifiers, used by Alembic.
revision = "0014_add_translations_table"
down_revision = "0013_add_popup_language_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "translations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(10), nullable=False),
        sa.Column("data", JSONB, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "tenant_id", "entity_type", "entity_id", "language",
            name="uq_translation_entity_language",
        ),
    )

    # Composite index for lookups
    op.create_index(
        "ix_translation_entity_lookup",
        "translations",
        ["entity_type", "entity_id", "language"],
    )

    # RLS policies and tenant permissions
    add_tenant_table_permissions("translations")


def downgrade():
    remove_tenant_table_permissions("translations")
    op.drop_index("ix_translation_entity_lookup", table_name="translations")
    op.drop_table("translations")
