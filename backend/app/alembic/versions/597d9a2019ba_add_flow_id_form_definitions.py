"""add flow id to form definitions

Design: sdd/sales-flows slice 6 (Q1: flow-owned forms) — adds a nullable
`sales_flow_id` FK+index to `formfields`, `formsections`, and
`basefieldconfigs` (actual table names — SQLModel's default lowercased
class name, no underscore; the `FormFields`/`FormSections`/
`BaseFieldConfigs` model classes never set `__tablename__`). No existing
row is touched: every pre-existing row
keeps `sales_flow_id IS NULL`, which this migration defines as the
"popup-shared" tier — the exact form every flow of a popup rendered before
this slice, and the fallback every flow keeps reading until an admin
explicitly gives it its own flow-scoped fields (no writer creates
flow-scoped rows yet in this slice; the backoffice editor lands in a later
slice).

Uniqueness re-keys to a two-tier partial-index shape, mirroring the
`email_templates` scope pattern (`4f2b3c1d9e8a_tenant_login_email_templates_scope.py`):

- Flow tier — `uq_form_field_name_flow` on `(name, sales_flow_id)`,
  `uq_base_field_config_flow_field` on `(sales_flow_id, field_name)`,
  both `WHERE sales_flow_id IS NOT NULL`.
- Popup-shared tier — `uq_form_field_name_popup_shared` on
  `(name, popup_id)`, `uq_base_field_config_popup_field_shared` on
  `(popup_id, field_name)`, both `WHERE sales_flow_id IS NULL`. This is a
  straight re-scope of the dropped plain constraints
  (`uq_form_field_name_popup`, `uq_base_field_config_popup_field`) —
  identical enforcement for every row that stays flow-less.

Postgres NULL semantics would otherwise let a plain `(name, sales_flow_id)`
constraint admit unlimited duplicate names once `sales_flow_id` is NULL
(every NULL is distinct in a unique index) — the popup-shared partial index
is what closes that hole for the tier that holds virtually all data this
slice.

`formsections` has no pre-existing unique constraint on label, so it only
gains the nullable column + FK + index — no re-key needed.

Downgrade drops the two-tier indexes and the column, restoring the plain
`uq_form_field_name_popup` / `uq_base_field_config_popup_field` constraints
— but only after verifying no cross-tier duplicate `(name, popup_id)` /
`(popup_id, field_name)` pair exists across ALL rows regardless of flow.
A collision would mean flow-scoped rows now conflict with the popup-shared
tier once the flow dimension collapses away; downgrading on top of that
would either corrupt data or fail with an opaque `IntegrityError`. This
migration NEVER deletes rows to resolve it — it raises and leaves every
column/constraint untouched.

Revision ID: 597d9a2019ba
Revises: e31496bde92c
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "597d9a2019ba"
down_revision = "e31496bde92c"
branch_labels = None
depends_on = None

_TABLES = ("formfields", "formsections", "basefieldconfigs")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
        )
        op.create_foreign_key(
            f"fk_{table}_sales_flow_id",
            table,
            "sales_flows",
            ["sales_flow_id"],
            ["id"],
        )
        op.create_index(f"ix_{table}_sales_flow_id", table, ["sales_flow_id"])

    op.drop_constraint("uq_form_field_name_popup", "formfields", type_="unique")
    op.create_index(
        "uq_form_field_name_flow",
        "formfields",
        ["name", "sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        "uq_form_field_name_popup_shared",
        "formfields",
        ["name", "popup_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    op.drop_constraint(
        "uq_base_field_config_popup_field", "basefieldconfigs", type_="unique"
    )
    op.create_index(
        "uq_base_field_config_flow_field",
        "basefieldconfigs",
        ["sales_flow_id", "field_name"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        "uq_base_field_config_popup_field_shared",
        "basefieldconfigs",
        ["popup_id", "field_name"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )


def downgrade() -> None:
    conn = op.get_bind()

    form_field_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT name, popup_id FROM formfields "
            "  GROUP BY name, popup_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if form_field_duplicates:
        raise RuntimeError(
            "add_flow_id_form_definitions downgrade aborted: "
            f"{form_field_duplicates} duplicate (name, popup_id) pair(s) in "
            "form_fields have more than one row across different sales "
            "flows. Downgrading would corrupt data — this migration NEVER "
            "deletes rows. Resolve or manually re-point the extra "
            "flow-scoped field(s) for the affected popup(s) before "
            "downgrading."
        )

    base_field_config_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id, field_name FROM basefieldconfigs "
            "  GROUP BY popup_id, field_name HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if base_field_config_duplicates:
        raise RuntimeError(
            "add_flow_id_form_definitions downgrade aborted: "
            f"{base_field_config_duplicates} duplicate (popup_id, "
            "field_name) pair(s) in base_field_configs have more than one "
            "row across different sales flows. Downgrading would corrupt "
            "data — this migration NEVER deletes rows. Resolve or manually "
            "re-point the extra flow-scoped config(s) for the affected "
            "popup(s) before downgrading."
        )

    op.drop_index(
        "uq_base_field_config_popup_field_shared", table_name="basefieldconfigs"
    )
    op.drop_index("uq_base_field_config_flow_field", table_name="basefieldconfigs")
    op.create_unique_constraint(
        "uq_base_field_config_popup_field",
        "basefieldconfigs",
        ["popup_id", "field_name"],
    )

    op.drop_index("uq_form_field_name_popup_shared", table_name="formfields")
    op.drop_index("uq_form_field_name_flow", table_name="formfields")
    op.create_unique_constraint(
        "uq_form_field_name_popup", "formfields", ["name", "popup_id"]
    )

    for table in reversed(_TABLES):
        op.drop_index(f"ix_{table}_sales_flow_id", table_name=table)
        op.drop_constraint(f"fk_{table}_sales_flow_id", table, type_="foreignkey")
        op.drop_column(table, "sales_flow_id")
