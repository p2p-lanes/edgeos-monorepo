"""every application belongs to exactly one sales flow

Design: sdd/sales-flows-rediseno F4 — the last nullable `sales_flow_id`.

`uq_application_human_flow` was re-keyed to (human_id, sales_flow_id) so a
person could apply once per flow rather than once per popup, but the column
stayed nullable, and in Postgres two NULLs are never equal. The constraint
therefore enforced nothing at all for flow-less rows: the same human could
hold any number of applications on the same popup, and the only thing
standing between them was an application-level check with its own legacy
branch. This makes the column NOT NULL, which is what makes the constraint
real.

Every application takes the default flow of its popup, which is what the
read paths were already falling back to. Once the column cannot be NULL,
those branches have nothing left to handle and go away with it.

Two conditions abort the migration rather than paper over the data:

- a popup with applications but no default flow. Provisioning gives every
  popup one, so this means the invariant is already broken and picking a
  flow here would only hide it.
- a (human_id, default_flow_id) pair that would collide once the NULLs are
  filled. That is a genuine duplicate application, and choosing which one
  survives is not a decision a migration gets to make.

Revision ID: f2a8c604b9e1
Revises: d4f1a72e9c85
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f2a8c604b9e1"
down_revision = "d4f1a72e9c85"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    orphans = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM applications a "
            "WHERE a.sales_flow_id IS NULL AND NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = a.popup_id AND f.is_default"
            ")"
        )
    ).scalar()
    if orphans:
        raise RuntimeError(
            "applications_flow_required: "
            f"{orphans} application(s) belong to a popup with no default flow"
        )

    collisions = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT a.human_id, f.id "
            "  FROM applications a "
            "  JOIN sales_flows f ON f.popup_id = a.popup_id AND f.is_default "
            "  WHERE a.sales_flow_id IS NULL OR a.sales_flow_id = f.id "
            "  GROUP BY a.human_id, f.id HAVING COUNT(*) > 1"
            ") AS dupes"
        )
    ).scalar()
    if collisions:
        raise RuntimeError(
            "applications_flow_required: "
            f"{collisions} human(s) would end up with two applications on the "
            "same default flow — resolve the duplicates first"
        )

    conn.execute(
        sa.text(
            "UPDATE applications a SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = a.popup_id AND f.is_default "
            "AND a.sales_flow_id IS NULL"
        )
    )

    op.alter_column(
        "applications",
        "sales_flow_id",
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "applications",
        "sales_flow_id",
        existing_type=sa.dialects.postgresql.UUID(as_uuid=True),
        nullable=True,
    )
