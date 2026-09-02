"""give each flow its own installment terms

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 3.
How many payments a buyer may split an order into is a condition of the sale,
and the sale belongs to a flow. The terms lived only on `popups`, so a partner
selling through their own door had to offer whatever the event offered.

Each flow takes its own copy, so no buyer is offered a different plan on the
day this runs.

The flow's columns are all NULLABLE, unlike the popup's originals — three of
those are NOT NULL with defaults. On a flow, an unset Class B column has
always meant "this flow says nothing", and a flow that says nothing about
installments offers none. The backfill fills them from the popup, so no
existing flow starts out silent.

The popup columns are deliberately left in place, in the order
`d4f1a72e9c85` set out: the backoffice stops offering them first, dropping
them is its own change.

Idempotent: only flow columns that are NULL are filled. Downgrade drops the
columns, which are new here.

Revision ID: a7e4b2c81f95
Revises: f1c7a4b90d63
Create Date: 2026-08-13 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a7e4b2c81f95"
down_revision = "f1c7a4b90d63"
branch_labels = None
depends_on = None

# Mirrors the new entries in app.api.sales_flow.schemas.EFFECTIVE_CONFIG_FIELDS.
# Duplicated rather than imported: a migration must not depend on application
# code that can change shape after it ships.
INSTALLMENT_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("installments_enabled", sa.Boolean()),
    ("installments_deadline", sa.DateTime(timezone=True)),
    ("installments_max", sa.Integer()),
    ("installments_interval", sa.String()),
    ("installments_interval_count", sa.Integer()),
)


def upgrade() -> None:
    for name, type_ in INSTALLMENT_COLUMNS:
        op.add_column("sales_flows", sa.Column(name, type_, nullable=True))

    assignments = ", ".join(
        f"{name} = popups.{name}" for name, _ in INSTALLMENT_COLUMNS
    )
    predicate = " AND ".join(
        f"sales_flows.{name} IS NULL" for name, _ in INSTALLMENT_COLUMNS
    )
    op.execute(
        f"""
        UPDATE sales_flows
        SET {assignments}
        FROM popups
        WHERE sales_flows.popup_id = popups.id
          AND {predicate}
        """  # noqa: S608 — column names are the module constant above, not input
    )


def downgrade() -> None:
    for name, _ in reversed(INSTALLMENT_COLUMNS):
        op.drop_column("sales_flows", name)
