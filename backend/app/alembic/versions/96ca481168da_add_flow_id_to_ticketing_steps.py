"""add flow id to ticketing steps

Design: sdd/sales-flows slice 8 — adds a nullable `sales_flow_id` FK+index
to `ticketingsteps` so a flow can own its own step list independently of
its popup. Two-tier resolution (task 8 binding, mirroring slice 6's forms
and slice 7's reviewers/approval-strategy re-keys): a flow that owns ANY
step row (`sales_flow_id = <flow>`) uses ONLY its own rows — the popup tier
never leaks in, even if the flow's list is a strict subset of the popup's.
A flow with zero rows of its own falls back to the popup-shared tier
(`sales_flow_id IS NULL`, the exact step list every popup had before this
slice — no existing row is touched).

Re-keys the pre-existing `uq_ticketing_step_patron_per_popup` partial
unique index (`fb7da98c8d72_patron_product_rules.py`) to the same two-tier
shape used throughout this series:

- Flow tier — `uq_ticketing_step_patron_flow` on `(sales_flow_id)` WHERE
  `template = 'patron-preset' AND is_enabled = TRUE AND sales_flow_id IS
  NOT NULL`.
- Popup-shared tier — `uq_ticketing_step_patron_popup_shared` on
  `(popup_id)` WHERE `template = 'patron-preset' AND is_enabled = TRUE AND
  sales_flow_id IS NULL` — a straight re-scope of the dropped index,
  identical enforcement for every row that stays flow-less.

Postgres NULL semantics would otherwise let the old plain-popup partial
index admit unlimited enabled patron-preset rows per popup once a second
flow starts owning its own copy — the popup-shared partial index is what
keeps the pre-existing "one enabled patron step per popup" promise for the
tier that holds every row this slice.

Downgrade drops the two-tier indexes and the column, restoring the plain
`uq_ticketing_step_patron_per_popup` — but only after verifying no popup
has more than one enabled patron-preset row across different flows. A
collision would mean flow-scoped rows now conflict with the popup-shared
tier once the flow dimension collapses away; downgrading on top of that
would either corrupt data or fail with an opaque `IntegrityError`. This
migration NEVER deletes rows to resolve it — it raises and leaves every
column/constraint untouched.

Revision ID: 96ca481168da
Revises: 9bf2a7a71d10
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "96ca481168da"
down_revision = "9bf2a7a71d10"
branch_labels = None
depends_on = None

_TABLE = "ticketingsteps"


def upgrade() -> None:
    op.add_column(
        _TABLE,
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        f"fk_{_TABLE}_sales_flow_id",
        _TABLE,
        "sales_flows",
        ["sales_flow_id"],
        ["id"],
    )
    op.create_index(f"ix_{_TABLE}_sales_flow_id", _TABLE, ["sales_flow_id"])

    op.drop_index("uq_ticketing_step_patron_per_popup", table_name=_TABLE)
    op.create_index(
        "uq_ticketing_step_patron_flow",
        _TABLE,
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text(
            "template = 'patron-preset' AND is_enabled = TRUE "
            "AND sales_flow_id IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_ticketing_step_patron_popup_shared",
        _TABLE,
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text(
            "template = 'patron-preset' AND is_enabled = TRUE AND sales_flow_id IS NULL"
        ),
    )


def downgrade() -> None:
    conn = op.get_bind()

    patron_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id FROM ticketingsteps "
            "  WHERE template = 'patron-preset' AND is_enabled = TRUE "
            "  GROUP BY popup_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if patron_duplicates:
        raise RuntimeError(
            "add_flow_id_ticketing_steps downgrade aborted: "
            f"{patron_duplicates} popup(s) have more than one enabled "
            "patron-preset ticketing step across different sales flows. "
            "Downgrading would corrupt data — this migration NEVER deletes "
            "rows. Resolve or manually re-point the extra flow-scoped "
            "patron step(s) for the affected popup(s) before downgrading."
        )

    op.drop_index("uq_ticketing_step_patron_popup_shared", table_name=_TABLE)
    op.drop_index("uq_ticketing_step_patron_flow", table_name=_TABLE)
    op.create_index(
        "uq_ticketing_step_patron_per_popup",
        _TABLE,
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("template = 'patron-preset' AND is_enabled = TRUE"),
    )

    op.drop_index(f"ix_{_TABLE}_sales_flow_id", table_name=_TABLE)
    op.drop_constraint(f"fk_{_TABLE}_sales_flow_id", _TABLE, type_="foreignkey")
    op.drop_column(_TABLE, "sales_flow_id")
