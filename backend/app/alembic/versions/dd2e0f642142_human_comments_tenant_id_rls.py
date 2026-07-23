"""human_comments tenant_id + RLS

Brings ``human_comments`` in line with every other tenant table: it was
created as a global table (no ``tenant_id``, no RLS, no tenant grants), so it
could only be reached through the privileged engine and its isolation relied
entirely on application code scoping by ``human_id``. This adds a real
``tenant_id`` column, backfills it from the owning human, and enables the
standard tenant-isolation RLS policy + grants so the tenant session enforces
isolation at the database level.

Revision ID: dd2e0f642142
Revises: e266b8601d0c
Create Date: 2026-07-21 21:23:00.436623

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "dd2e0f642142"
down_revision = "e266b8601d0c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add tenant_id (nullable so existing rows can be backfilled).
    op.add_column(
        "human_comments",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # 2) Backfill from the owning human. Comments cascade-delete with the human,
    #    so every row has a valid human and therefore a tenant.
    op.execute(
        """
        UPDATE human_comments hc
        SET tenant_id = h.tenant_id
        FROM humans h
        WHERE hc.human_id = h.id
        """
    )

    # 3) Enforce NOT NULL, add the FK + index, matching other tenant tables.
    op.alter_column("human_comments", "tenant_id", nullable=False)
    op.create_index(
        "ix_human_comments_tenant_id", "human_comments", ["tenant_id"]
    )
    op.create_foreign_key(
        "fk_human_comments_tenant_id",
        "human_comments",
        "tenants",
        ["tenant_id"],
        ["id"],
    )

    # 4) Grants + RLS tenant-isolation policy (standard helper).
    add_tenant_table_permissions("human_comments")


def downgrade() -> None:
    remove_tenant_table_permissions("human_comments")
    op.drop_constraint(
        "fk_human_comments_tenant_id", "human_comments", type_="foreignkey"
    )
    op.drop_index("ix_human_comments_tenant_id", table_name="human_comments")
    op.drop_column("human_comments", "tenant_id")
