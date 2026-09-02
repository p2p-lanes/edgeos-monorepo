"""a flow chooses how its checkout looks

Design: sdd/sales-flows-rediseno — the last of the flow-scoped resources.

`theme_config` lived only on the popup, so every flow of a gathering sold
under the same colours. A volunteer intake and a sponsor upsale are
different rooms, and the redesign already lets them differ in every other
way they meet a buyer: their steps, their form, their emails.

Each flow takes a copy of the popup's theme, so nothing changes for anyone
on the day this runs. What changes is afterwards: a flow can be restyled
without touching the gathering, and the gathering's own pages — the portal
outside checkout, where no flow is in scope — keep reading their own.

NULL means "no overrides", exactly as it does on the popup today. It does
NOT mean "ask the popup": that read-through is the shape every other slice
of this redesign removed, and reintroducing it here for one JSONB column
would put it back.

Idempotent: only flows whose theme is unset are filled, so re-running is a
no-op and a flow already restyled by hand keeps its own.

Downgrade is deliberately a no-op — a filled column is indistinguishable
from one an operator set on purpose afterwards.

Revision ID: e6d3a95c17b2
Revises: d9f2b6c48a37
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "e6d3a95c17b2"
down_revision = "d9f2b6c48a37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_flows",
        sa.Column("theme_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.execute(
        "UPDATE sales_flows f SET theme_config = p.theme_config "
        "FROM popups p "
        "WHERE p.id = f.popup_id AND f.theme_config IS NULL"
    )


def downgrade() -> None:
    op.drop_column("sales_flows", "theme_config")
