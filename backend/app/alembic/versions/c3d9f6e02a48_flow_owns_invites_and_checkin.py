"""give each flow its own invites and check-in timing

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 4.
Two settings, two reasons, one shape:

`edit_passes_enabled` was meant to travel with them and does not. It has no
backend reader at all — the portal reads it straight off the popup — so a
column here would be written and never consulted, which is the shape this
whole redesign has been removing. Giving the portal a per-flow answer needs a
way to carry flow configuration to it, and the obvious one was just narrowed
to keep a signing secret out of buyers' hands. That is a decision, not a flag.

- `invites_enabled`: an invite already names the flow it lands its recipient
  in (`invites.sales_flow_id` is NOT NULL), so the switch that allows one
  belonged to the same flow all along.
- `checkin_pass_lead_days`: the email's template is flow-owned since slice 3
  of the original redesign. Timing has to follow the wording, or a flow can
  write its own message and not choose when it goes.

Each flow takes a copy of what its popup had, so nothing changes for anyone on
the day this runs. The popup columns stay until the backoffice stops offering
them, in the order `d4f1a72e9c85` set out.

Idempotent: only flow columns that are NULL are filled.

Revision ID: c3d9f6e02a48
Revises: a7e4b2c81f95
Create Date: 2026-08-13 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c3d9f6e02a48"
down_revision = "a7e4b2c81f95"
branch_labels = None
depends_on = None

# Mirrors the new entries in app.api.sales_flow.schemas.EFFECTIVE_CONFIG_FIELDS.
# Duplicated rather than imported: a migration must not depend on application
# code that can change shape after it ships.
COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("invites_enabled", sa.Boolean()),
    ("checkin_pass_lead_days", sa.Integer()),
)


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("sales_flows", sa.Column(name, type_, nullable=True))

    assignments = ", ".join(f"{name} = popups.{name}" for name, _ in COLUMNS)
    predicate = " AND ".join(f"sales_flows.{name} IS NULL" for name, _ in COLUMNS)
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
    for name, _ in reversed(COLUMNS):
        op.drop_column("sales_flows", name)
