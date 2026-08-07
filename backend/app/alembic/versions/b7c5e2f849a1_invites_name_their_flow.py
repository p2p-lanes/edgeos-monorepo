"""an invite says which flow it invites someone into

Design: sdd/sales-flows-rediseno — the flow-scoped resources, invites first.

An invite creates an application when it is redeemed, and since F4 every
application belongs to a flow. The invite never said which, so
`resolve_target_flow_id` fell back to the popup's default flow: an invite
meant for Volunteers put the person in the default flow, silently. Nobody
could see it because the invite had no flow to disagree with.

Every existing invite takes the default flow it was already landing people
in, so nothing changes for an invite already in circulation. What changes is
that a new one can name a different flow and be believed.

Only application flows may be named. A direct sale produces no application,
so an invite into one would redeem into nothing — the same rule the approval
strategy already enforces.

The migration aborts on a popup that has invites but no default application
flow rather than inventing one. That means the popup takes invites it cannot
land anywhere, which is a state to look at, not to paper over.

Revision ID: b7c5e2f849a1
Revises: e8b3f5a17d26
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b7c5e2f849a1"
down_revision = "e8b3f5a17d26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "invites",
        sa.Column("sales_flow_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_invites_sales_flow_id", "invites", "sales_flows", ["sales_flow_id"], ["id"]
    )
    op.create_index("ix_invites_sales_flow_id", "invites", ["sales_flow_id"])

    orphans = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM invites i "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = i.popup_id AND f.is_default "
            "  AND f.type = 'application'"
            ")"
        )
    ).scalar()
    if orphans:
        raise RuntimeError(
            "invites_name_their_flow: "
            f"{orphans} invite(s) belong to a popup whose default flow does not "
            "take applications"
        )

    conn.execute(
        sa.text(
            "UPDATE invites i SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = i.popup_id AND f.is_default"
        )
    )

    op.alter_column(
        "invites",
        "sales_flow_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


def downgrade() -> None:
    op.drop_index("ix_invites_sales_flow_id", table_name="invites")
    op.drop_constraint("fk_invites_sales_flow_id", "invites", type_="foreignkey")
    op.drop_column("invites", "sales_flow_id")
