"""backfill primary sales flows

Creates one primary sales flow for every existing popup that has none. The
canonical application flow is named and slugged `Attendee`/`attendee`; the
canonical direct flow is `Checkout`/`checkout`.

Revision ID: 4a983282b8aa
Revises: b79d252e79c2
"""

import sqlalchemy as sa
from alembic import op

revision = "4a983282b8aa"
down_revision = "b79d252e79c2"
branch_labels = None
depends_on = None


def primary_flow_identity(sale_type: str) -> tuple[str, str]:
    if sale_type == "application":
        return "attendee", "Attendee"
    return "checkout", "Checkout"


def upgrade() -> None:
    conn = op.get_bind()
    popups_needing_primary_flow = conn.execute(
        sa.text(
            "SELECT id, tenant_id, sale_type FROM popups p "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = p.id AND f.is_default = true"
            ")"
        )
    ).all()

    for popup_id, tenant_id, sale_type in popups_needing_primary_flow:
        slug, name = primary_flow_identity(sale_type)
        conn.execute(
            sa.text(
                "INSERT INTO sales_flows "
                "(id, tenant_id, popup_id, type, slug, name, visibility, "
                'is_default, "order", reviewers_mode, identity_mode) '
                "SELECT gen_random_uuid(), :tenant_id, :popup_id, :sale_type, "
                ":slug, :name, 'portal_listed', true, 0, 'inherit', 'portal_auth' "
                "WHERE NOT EXISTS (SELECT 1 FROM sales_flows f "
                "WHERE f.popup_id = :popup_id AND f.is_default = true)"
            ).bindparams(
                tenant_id=tenant_id,
                popup_id=popup_id,
                sale_type=sale_type,
                slug=slug,
                name=name,
            )
        )

    orphan_count = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM popups p "
            "LEFT JOIN sales_flows f "
            "  ON f.popup_id = p.id AND f.is_default = true "
            "WHERE f.id IS NULL"
        )
    ).scalar()
    if orphan_count:
        raise RuntimeError(
            "backfill_primary_sales_flows invariant violated: "
            f"{orphan_count} popup(s) have no primary sales_flow"
        )


def downgrade() -> None:
    op.execute(
        "DELETE FROM sales_flows "
        "WHERE is_default AND slug IN ('attendee', 'checkout') "
        "AND name IN ('Attendee', 'Checkout')"
    )
