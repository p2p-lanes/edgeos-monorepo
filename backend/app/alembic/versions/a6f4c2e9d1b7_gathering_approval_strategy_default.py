"""restore gathering approval strategy defaults

Revision ID: a6f4c2e9d1b7
Revises: c7e5a1b9d3f2
Create Date: 2026-09-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6f4c2e9d1b7"
down_revision: str | None = "c7e5a1b9d3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLOW_INDEX = "uq_approval_strategy_flow"
SHARED_INDEX = "uq_approval_strategy_popup_shared"
AUTO_ACCEPT_DB_VALUE = "AUTO_ACCEPT"
ANY_REVIEWER_DB_VALUE = "ANY_REVIEWER"


def upgrade() -> None:
    op.alter_column(
        "approvalstrategies",
        "sales_flow_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )
    op.drop_index(FLOW_INDEX, table_name="approvalstrategies")
    op.create_index(
        FLOW_INDEX,
        "approvalstrategies",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        SHARED_INDEX,
        "approvalstrategies",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE approvalstrategies AS strategy "
            "SET sales_flow_id = NULL "
            "FROM sales_flows AS flow "
            "WHERE strategy.sales_flow_id = flow.id AND flow.is_default = true"
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO approvalstrategies "
            "(id, popup_id, tenant_id, sales_flow_id, strategy_type) "
            "SELECT gen_random_uuid(), popup.id, popup.tenant_id, NULL, "
            ":strategy_type "
            "FROM popups AS popup "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM approvalstrategies AS strategy "
            "  WHERE strategy.popup_id = popup.id AND strategy.sales_flow_id IS NULL"
            ")"
        ),
        {"strategy_type": AUTO_ACCEPT_DB_VALUE},
    )
    op.alter_column(
        "approvalstrategies",
        "strategy_type",
        existing_type=sa.String(length=50),
        server_default=AUTO_ACCEPT_DB_VALUE,
        existing_nullable=False,
    )


def downgrade() -> None:
    conn = op.get_bind()
    missing_defaults = conn.execute(
        sa.text(
            "SELECT strategy.popup_id "
            "FROM approvalstrategies AS strategy "
            "LEFT JOIN sales_flows AS flow "
            "  ON flow.popup_id = strategy.popup_id AND flow.is_default = true "
            "WHERE strategy.sales_flow_id IS NULL AND flow.id IS NULL LIMIT 10"
        )
    ).all()
    if missing_defaults:
        ids = ", ".join(str(row[0]) for row in missing_defaults)
        raise RuntimeError(
            "gathering approval strategy downgrade aborted: gathering "
            "strategies cannot be preserved without a default sales flow "
            f"(first popup ids: {ids})"
        )

    collisions = conn.execute(
        sa.text(
            "SELECT shared.popup_id "
            "FROM approvalstrategies AS shared "
            "JOIN sales_flows AS flow "
            "  ON flow.popup_id = shared.popup_id AND flow.is_default = true "
            "JOIN approvalstrategies AS override "
            "  ON override.sales_flow_id = flow.id "
            "WHERE shared.sales_flow_id IS NULL LIMIT 10"
        )
    ).all()
    if collisions:
        ids = ", ".join(str(row[0]) for row in collisions)
        raise RuntimeError(
            "gathering approval strategy downgrade aborted: both a gathering "
            "strategy and default-flow override exist and cannot be collapsed "
            f"losslessly (first popup ids: {ids})"
        )

    conn.execute(
        sa.text(
            "UPDATE approvalstrategies AS strategy "
            "SET sales_flow_id = flow.id "
            "FROM sales_flows AS flow "
            "WHERE strategy.popup_id = flow.popup_id "
            "  AND strategy.sales_flow_id IS NULL AND flow.is_default = true"
        )
    )

    op.drop_index(SHARED_INDEX, table_name="approvalstrategies")
    op.drop_index(FLOW_INDEX, table_name="approvalstrategies")
    op.create_index(FLOW_INDEX, "approvalstrategies", ["sales_flow_id"], unique=True)
    op.alter_column(
        "approvalstrategies",
        "sales_flow_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
    op.alter_column(
        "approvalstrategies",
        "strategy_type",
        existing_type=sa.String(length=50),
        server_default=ANY_REVIEWER_DB_VALUE,
        existing_nullable=False,
    )
