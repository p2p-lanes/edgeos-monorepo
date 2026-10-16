"""Let a sales flow hold its ticket sales as "coming soon".

Revision ID: 50c71da1e604
Revises: 36cf5a3e5a12

`ticket_sales_status` is "open" for every existing flow, so nothing changes
until an organiser switches one to "coming_soon". While it is, the flow keeps
taking applications, accepted people see the flow's coming-soon title and
message instead of a checkout, and every purchase path refuses. The two texts
are NULL by default, which the portal reads as its own translated copy.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "50c71da1e604"
down_revision: str | None = "36cf5a3e5a12"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sales_flows",
        sa.Column(
            "ticket_sales_status",
            sa.String(),
            nullable=False,
            server_default="open",
        ),
    )
    op.add_column(
        "sales_flows", sa.Column("coming_soon_title", sa.String(), nullable=True)
    )
    op.add_column(
        "sales_flows", sa.Column("coming_soon_message", sa.Text(), nullable=True)
    )
    op.create_check_constraint(
        "ck_sales_flows_ticket_sales_status",
        "sales_flows",
        "ticket_sales_status IN ('open', 'coming_soon')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_sales_flows_ticket_sales_status", "sales_flows", type_="check"
    )
    op.drop_column("sales_flows", "coming_soon_message")
    op.drop_column("sales_flows", "coming_soon_title")
    op.drop_column("sales_flows", "ticket_sales_status")
