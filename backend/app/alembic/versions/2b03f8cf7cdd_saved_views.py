"""saved_views

Team-shared saved views: named list configurations (filters, columns) scoped
to a popup and entity. Tenant-scoped with the standard RLS policy and grants.

Revision ID: 2b03f8cf7cdd
Revises: cb6357be874e
Create Date: 2026-07-26

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "2b03f8cf7cdd"
down_revision = "cb6357be874e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_views",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("entity", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_saved_views_tenant_id",
        ),
        sa.ForeignKeyConstraint(
            ["popup_id"],
            ["popups.id"],
            name="fk_saved_views_popup_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_saved_views_created_by",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_saved_views"),
        sa.UniqueConstraint(
            "popup_id", "entity", "name", name="uq_saved_view_popup_entity_name"
        ),
    )
    op.create_index("ix_saved_views_tenant_id", "saved_views", ["tenant_id"])
    op.create_index("ix_saved_views_popup_id", "saved_views", ["popup_id"])
    op.create_index("ix_saved_views_entity", "saved_views", ["entity"])
    op.create_index("ix_saved_views_created_by", "saved_views", ["created_by"])
    add_tenant_table_permissions("saved_views")


def downgrade() -> None:
    remove_tenant_table_permissions("saved_views")
    op.drop_index("ix_saved_views_created_by", table_name="saved_views")
    op.drop_index("ix_saved_views_entity", table_name="saved_views")
    op.drop_index("ix_saved_views_popup_id", table_name="saved_views")
    op.drop_index("ix_saved_views_tenant_id", table_name="saved_views")
    op.drop_table("saved_views")
