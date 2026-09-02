"""give each flow its own insurance and contribution settings

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 2.
Insurance and contribution are fees added at a checkout, and a checkout
belongs to a flow: a door selling to volunteers should not add a contribution
to their order because the general one does. They lived only on `popups`, so
every way into a gathering charged the same.

Each flow takes its own copy of what its popup charges, so nothing changes
for any buyer on the day this runs. What changes is afterwards — a flow can
be set apart without touching the others.

The popup columns are deliberately left in place. Dropping them is a separate
change, once the backoffice has stopped offering them at popup level, which is
the same order `d4f1a72e9c85` set out for the eighteen before these.

`contribution_label` and `contribution_description` come along even though no
code reads them from the popup today: they are the copy shown beside the fee
in the checkout summary, and copy that cannot follow its fee to another flow
is copy that will describe the wrong thing.

Idempotent: only flow columns that are NULL are filled, so re-running is a
no-op. Downgrade drops the columns — they are new here, so there is nothing
an operator could have meant by their values that predates this.

Revision ID: f1c7a4b90d63
Revises: e6d3a95c17b2
Create Date: 2026-08-13 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f1c7a4b90d63"
down_revision = "e6d3a95c17b2"
branch_labels = None
depends_on = None

# Mirrors the new entries in app.api.sales_flow.schemas.EFFECTIVE_CONFIG_FIELDS.
# Duplicated rather than imported: a migration must not depend on application
# code that can change shape after it ships.
FEE_COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("insurance_enabled", sa.Boolean()),
    ("insurance_percentage", sa.Numeric(5, 2)),
    ("contribution_enabled", sa.Boolean()),
    ("contribution_percentage", sa.Numeric(5, 2)),
    ("contribution_label", sa.String()),
    ("contribution_description", sa.Text()),
)


def upgrade() -> None:
    for name, type_ in FEE_COLUMNS:
        op.add_column("sales_flows", sa.Column(name, type_, nullable=True))

    assignments = ", ".join(f"{name} = popups.{name}" for name, _ in FEE_COLUMNS)
    predicate = " AND ".join(f"sales_flows.{name} IS NULL" for name, _ in FEE_COLUMNS)
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
    for name, _ in reversed(FEE_COLUMNS):
        op.drop_column("sales_flows", name)
