"""add flow id email templates and logs

Design: sdd/sales-flows slice 10 — adds a nullable `sales_flow_id` FK+index
to `email_templates` so a flow can own its own custom template independently
of its popup, and a nullable `sales_flow_id` plain column (no FK, matching
`popup_id`'s own denormalized style — see `email_logs/models.py`'s
docstring) to `email_logs` so the reminder dispatcher can dedupe sends per
flow.

Three-tier resolution (`services/email/service.py`, this slice): flow (if a
row exists AND `is_active`) -> popup (`sales_flow_id IS NULL`, unchanged
existing behavior) -> tenant/file fallback. An inactive flow-tier row falls
through to the popup tier, never blocking the send.

Re-scopes the two email-template unique indexes to a two-tier partial-index
shape, the same pattern as every other cutover in this series
(`popup_reviewers`, `ticketing_steps`, `form_fields`):

- Flow tier (new) — `uq_email_template_flow_scope_type` on
  `(sales_flow_id, template_type)` WHERE `sales_flow_id IS NOT NULL`.
- Popup-shared tier (re-scoped) — `uq_email_template_popup_scope_type` on
  `(popup_id, template_type)` WHERE `popup_id IS NOT NULL AND sales_flow_id
  IS NULL` — closes the hole Postgres NULL semantics would otherwise open:
  once a flow starts owning its own copy, the old plain
  `popup_id IS NOT NULL` partial index would still block a distinct
  popup-shared row of the same type from ever being created alongside it
  (both partial indexes must exist, disjoint by `sales_flow_id`, for a flow
  row and a popup-shared row of the same type to coexist).

`ck_email_templates_scope` is extended so `login_code_human` (the only
tenant-scoped template type) requires BOTH `popup_id` and `sales_flow_id`
NULL — a portal login-code email was never popup-scoped to begin with, so it
is not flow-scopable either. Every other template type is unaffected: it
still requires `popup_id IS NOT NULL` regardless of tier.

`email_logs.sales_flow_id` is backfilled for the three reminder template
types only (`abandoned_cart`, `purchase_reminder`, `abandoned_application`)
to the popup's default sales_flow, mirroring
`4e221ea1a2ee_add_flow_id_applications_payments.py`'s own backfill shape.
Migration-hazard mitigation (design's reminder-dispatcher-key section, all
three, only the first is this migration's job): (1) THIS backfill; (2) for
one release `email_log/crud.py::get_reminder_stats` also matches
`sales_flow_id IS NULL` rows against a flow's `is_default` flag, so any row
this backfill cannot reach (its popup has no default flow) still counts
against that popup's default-flow dispatch instead of vanishing from
history; (3) the reminder dispatcher work (`services/reminder_dispatch.py`,
same slice) does not touch this migration.

Downgrade for `email_logs` is a clean column drop (no duplicate-data
hazard — the column is a read partition key, not a uniqueness dimension).
Downgrade for `email_templates` aborts loudly instead if any
`(popup_id, template_type)` pair has more than one row across tiers: once
`sales_flow_id` is dropped, two flow-scoped rows of the same type (or a
flow-scoped row alongside a popup-shared row of the same type) would
collide against the restored plain `uq_email_template_popup_scope_type`.
This migration NEVER deletes rows to resolve that — it raises and leaves
every column/constraint untouched, same as every other two-tier re-key in
this series.

Revision ID: 66d0a714e001
Revises: 96ca481168da
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "66d0a714e001"
down_revision = "96ca481168da"
branch_labels = None
depends_on = None

_REMINDER_TEMPLATE_TYPES = (
    "abandoned_cart",
    "purchase_reminder",
    "abandoned_application",
)
# Fixed constant, never user input — safe to inline as a SQL literal list.
_REMINDER_TYPES_SQL_LIST = ", ".join(f"'{t}'" for t in _REMINDER_TEMPLATE_TYPES)

_ORIGINAL_CK = (
    "(template_type IN ('login_code_human') AND popup_id IS NULL) "
    "OR (template_type NOT IN ('login_code_human') AND popup_id IS NOT NULL)"
)

_NEW_CK = (
    "(template_type IN ('login_code_human') "
    "AND popup_id IS NULL AND sales_flow_id IS NULL) "
    "OR (template_type NOT IN ('login_code_human') AND popup_id IS NOT NULL)"
)


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "email_templates",
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_email_templates_sales_flow_id",
        "email_templates",
        "sales_flows",
        ["sales_flow_id"],
        ["id"],
    )
    op.create_index(
        "ix_email_templates_sales_flow_id", "email_templates", ["sales_flow_id"]
    )

    op.drop_index("uq_email_template_popup_scope_type", table_name="email_templates")
    op.create_index(
        "uq_email_template_popup_scope_type",
        "email_templates",
        ["popup_id", "template_type"],
        unique=True,
        postgresql_where=sa.text("popup_id IS NOT NULL AND sales_flow_id IS NULL"),
    )
    op.create_index(
        "uq_email_template_flow_scope_type",
        "email_templates",
        ["sales_flow_id", "template_type"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )

    op.drop_constraint("ck_email_templates_scope", "email_templates", type_="check")
    op.create_check_constraint("ck_email_templates_scope", "email_templates", _NEW_CK)

    op.add_column(
        "email_logs",
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_email_logs_sales_flow_id", "email_logs", ["sales_flow_id"])

    # Idempotent backfill: only touches reminder-type rows without a
    # sales_flow_id yet, scoped to popups that have a default flow.
    conn.execute(
        sa.text(
            "UPDATE email_logs l SET sales_flow_id = f.id "
            "FROM sales_flows f "
            "WHERE f.popup_id = l.popup_id AND f.is_default = true "
            "AND l.sales_flow_id IS NULL AND l.popup_id IS NOT NULL "
            f"AND l.template_type IN ({_REMINDER_TYPES_SQL_LIST})"
        )
    )

    # Coverage invariant: every reminder-type row whose popup has a default
    # flow must now carry that flow's id. A violation aborts the migration.
    missing = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM email_logs l "
            "JOIN sales_flows f ON f.popup_id = l.popup_id AND f.is_default = true "
            "WHERE l.sales_flow_id IS NULL "
            f"AND l.template_type IN ({_REMINDER_TYPES_SQL_LIST})"
        )
    ).scalar()
    if missing:
        raise RuntimeError(
            "add_flow_id_email_templates_and_logs invariant violated: "
            f"{missing} email_logs row(s) of a reminder template type "
            "missing sales_flow_id despite their popup having a default "
            "sales_flow"
        )


def downgrade() -> None:
    conn = op.get_bind()

    duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id, template_type FROM email_templates "
            "  WHERE popup_id IS NOT NULL "
            "  GROUP BY popup_id, template_type HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if duplicates:
        raise RuntimeError(
            "add_flow_id_email_templates_and_logs downgrade aborted: "
            f"{duplicates} (popup_id, template_type) pair(s) have more than "
            "one email_templates row across different sales flows. "
            "Downgrading would corrupt data — this migration NEVER deletes "
            "rows. Resolve or manually remove the extra flow-scoped "
            "template(s) for the affected popup(s) before downgrading."
        )

    op.drop_index("ix_email_logs_sales_flow_id", table_name="email_logs")
    op.drop_column("email_logs", "sales_flow_id")

    op.drop_constraint("ck_email_templates_scope", "email_templates", type_="check")
    op.create_check_constraint(
        "ck_email_templates_scope", "email_templates", _ORIGINAL_CK
    )

    op.drop_index("uq_email_template_flow_scope_type", table_name="email_templates")
    op.drop_index("uq_email_template_popup_scope_type", table_name="email_templates")
    op.create_index(
        "uq_email_template_popup_scope_type",
        "email_templates",
        ["popup_id", "template_type"],
        unique=True,
        postgresql_where=sa.text("popup_id IS NOT NULL"),
    )

    op.drop_index("ix_email_templates_sales_flow_id", table_name="email_templates")
    op.drop_constraint(
        "fk_email_templates_sales_flow_id", "email_templates", type_="foreignkey"
    )
    op.drop_column("email_templates", "sales_flow_id")
