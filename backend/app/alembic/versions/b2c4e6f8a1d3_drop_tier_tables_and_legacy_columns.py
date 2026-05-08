"""drop_tier_tables_and_legacy_columns: drop tier tables and legacy columns.

Drops:
  - ticket_tier_phase (FK to ticket_tier_group — drop phase first)
  - ticket_tier_group
  - popups.tier_progression_enabled (column)
  - products.start_date (legacy column — was not used at runtime)
  - products.end_date (legacy column — was not used at runtime)

This is a forward-only migration. Data already backfilled in migration
a1b9c3d7e5f2 (sale_starts_at / sale_ends_at on products). No data is lost
that was not explicitly accepted.

Revision ID: b2c4e6f8a1d3
Revises: a1b9c3d7e5f2
Create Date: 2026-05-08
"""

from collections.abc import Sequence

from alembic import op

from app.alembic.utils import (
    remove_readonly_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision: str = "b2c4e6f8a1d3"
down_revision: str = "a1b9c3d7e5f2"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # 1. Drop ticket_tier_phase first (has FK to ticket_tier_group).
    #    Revoke grants before the DROP so role permissions are clean.
    remove_readonly_table_permissions("ticket_tier_phase")
    op.drop_table("ticket_tier_phase")

    # 2. Drop ticket_tier_group.
    remove_tenant_table_permissions("ticket_tier_group")
    op.drop_table("ticket_tier_group")

    # 3. Drop popups.tier_progression_enabled column.
    op.drop_column("popups", "tier_progression_enabled")

    # 4. Drop products.start_date and products.end_date (legacy columns,
    #    replaced by sale_starts_at / sale_ends_at in migration a1b9c3d7e5f2).
    op.drop_column("products", "start_date")
    op.drop_column("products", "end_date")


def downgrade() -> None:
    raise NotImplementedError("forward-only migration; restore from backup")
