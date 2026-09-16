"""a group says which flow its members apply through

Design: sdd/sales-flows-rediseno — the flow-scoped resources, groups after
invites.

Joining a group produces an application, and since F4 every application
belongs to a flow. The group never said which, so the application landed in
whichever flow the popup called default. A group made for a partner
organisation with its own questions and its own acceptance email quietly
sent everyone through the general one.

Every existing group takes the default flow its members were already landing
in, so nothing changes for a group already collecting people.

Only application flows may be named. A group is reached through an
application — `payments/crud.py` reads it as `application.group` — so a
group on a direct sale would never be looked at.

Aborts on a popup that has groups but no default application flow rather
than inventing one.

Revision ID: c4a91e37f5d8
Revises: b7c5e2f849a1
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c4a91e37f5d8"
down_revision = "b7c5e2f849a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "groups",
        sa.Column("sales_flow_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_groups_sales_flow_id", "groups", "sales_flows", ["sales_flow_id"], ["id"]
    )
    op.create_index("ix_groups_sales_flow_id", "groups", ["sales_flow_id"])

    orphans = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM groups g "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = g.popup_id AND f.is_default "
            "  AND f.type = 'application'"
            ")"
        )
    ).scalar()
    if orphans:
        raise RuntimeError(
            "groups_name_their_flow: "
            f"{orphans} group(s) belong to a popup whose default flow does not "
            "take applications"
        )

    conn.execute(
        sa.text(
            "UPDATE groups g SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = g.popup_id AND f.is_default"
        )
    )

    op.alter_column(
        "groups",
        "sales_flow_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_index("ix_groups_sales_flow_id", table_name="groups")
    op.drop_constraint("fk_groups_sales_flow_id", "groups", type_="foreignkey")
    op.drop_column("groups", "sales_flow_id")
