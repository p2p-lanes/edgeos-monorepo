"""ticket_tier_groups: add ticket_tier_group and ticket_tier_phase tables plus popup flag.

Adds:
  - ticket_tier_group (id, tenant_id, name, shared_stock_cap, shared_stock_remaining)
  - ticket_tier_phase (id, group_id, product_id UNIQUE, order, label, sale_starts_at, sale_ends_at)
    with UNIQUE(group_id, order)
  - popups.tier_progression_enabled (bool, NOT NULL, default false)

Both new tables are tenant-scoped and get full RLS via add_tenant_table_permissions.

Revision ID: 383a07c89142
Revises: b4f2a9c1e803
Create Date: 2026-04-19
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

from app.alembic.utils import (
    add_readonly_table_permissions,
    add_tenant_table_permissions,
    remove_readonly_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision: str = "383a07c89142"
down_revision: str = "e6a1d9b4c7f2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # 1. Create ticket_tier_group table
    op.create_table(
        "ticket_tier_group",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("shared_stock_cap", sa.Integer(), nullable=True),
        sa.Column("shared_stock_remaining", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    add_tenant_table_permissions("ticket_tier_group")

    # 2. Create ticket_tier_phase table
    op.create_table(
        "ticket_tier_phase",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("group_id", UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", UUID(as_uuid=True), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("sale_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sale_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["ticket_tier_group.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("product_id", name="uq_ticket_tier_phase_product_id"),
        sa.UniqueConstraint("group_id", "order", name="uq_ticket_tier_phase_group_order"),
    )
    # ticket_tier_phase has no tenant_id column — isolation is enforced through
    # the group_id FK (group has RLS). Grant table-level permissions only.
    add_readonly_table_permissions("ticket_tier_phase")

    # 3. Add tier_progression_enabled flag to popups
    op.add_column(
        "popups",
        sa.Column(
            "tier_progression_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    # 1. Remove popup flag
    op.drop_column("popups", "tier_progression_enabled")

    # 2. Drop ticket_tier_phase (no RLS — just revoke grants)
    remove_readonly_table_permissions("ticket_tier_phase")
    op.drop_table("ticket_tier_phase")

    # 3. Drop ticket_tier_group (must remove permissions before drop)
    remove_tenant_table_permissions("ticket_tier_group")
    op.drop_table("ticket_tier_group")
