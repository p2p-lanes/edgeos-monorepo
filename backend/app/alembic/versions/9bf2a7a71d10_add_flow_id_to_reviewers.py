"""add flow id to reviewers

Design: sdd/sales-flows slice 7 (D4: reviewer tri-state) — adds a nullable
`sales_flow_id` FK+index to `popupreviewers` (actual table name — SQLModel's
default lowercased class name, no underscore) so a flow can either inherit
its popup's reviewer list or fully replace it. The tri-state itself lives on
`sales_flows.reviewers_mode` (added in slice 1, unchanged here): `inherit`
reads `popupreviewers WHERE sales_flow_id IS NULL`; `override` reads
`popupreviewers WHERE sales_flow_id = <flow>` and treats zero rows as a valid
answer (no reviewers) — the popup tier never falls through once a flow
overrides.

Also re-keys `approvalstrategies` the same way (orchestrator's binding
extension of this slice, beyond the reviewer table alone): a flow may later
own its own approval strategy instead of the popup's. No write path creates
a flow-scoped `approvalstrategies` row yet (the backoffice editor for it is
slice 14) — this migration only makes the schema and read-resolution ready
for that cutover, per the design's fallback-authority rule ("the popup
column stays authoritative until that area's cutover slice lands").

Column named `sales_flow_id`, matching the naming convention used by every
other cutover in this series (`applications.sales_flow_id`,
`payments.sales_flow_id`, `formfields.sales_flow_id`, etc.) — corrected
in place (read-001 review finding) before this migration was ever deployed
beyond local testcontainers.

Uniqueness re-keys to a two-tier partial-index shape, mirroring slice 6's
`form_fields`/`base_field_configs` re-key and the `email_templates` scope
pattern:

- `popupreviewers`: flow tier `uq_popup_reviewer_flow` on `(sales_flow_id,
  user_id)` WHERE `sales_flow_id IS NOT NULL`; popup-shared tier
  `uq_popup_reviewer_popup_shared` on `(popup_id, user_id)` WHERE
  `sales_flow_id IS NULL` — re-scopes the dropped `uq_popup_reviewer`,
  identical enforcement for every row that stays flow-less.
- `approvalstrategies`: flow tier `uq_approval_strategy_flow` on
  `(sales_flow_id)` WHERE `sales_flow_id IS NOT NULL`; popup-shared tier
  `uq_approval_strategy_popup_shared` on `(popup_id)` WHERE `sales_flow_id
  IS NULL` — re-scopes the dropped `uq_approval_strategy_popup`.

Postgres NULL semantics would otherwise let a plain constraint including
`sales_flow_id` admit unlimited duplicates once `sales_flow_id` is NULL
(every NULL is distinct in a unique index) — the popup-shared partial index
is what closes that hole for the tier that holds every pre-existing row this
slice.

`approvalstrategies.popup_id` also carries a second, redundant plain unique
index (`ix_approvalstrategies_popup_id`, created alongside the named
`uq_approval_strategy_popup` constraint by the original 0003 migration's
`unique=True, index=True` column flags — both enforced the same thing).
That index alone would keep blocking a second popup-scoped row per popup
regardless of `sales_flow_id`, defeating the re-key, so this migration drops
it too and does not recreate it (the two-tier `uq_approval_strategy_popup_shared`
partial index supersedes it for the popup-shared tier).

Downgrade drops the two-tier indexes and the column, restoring the plain
`uq_popup_reviewer` / `uq_approval_strategy_popup` constraints (including
the redundant `ix_approvalstrategies_popup_id` index, to leave the table
byte-for-byte as this migration found it) — but only
after verifying no cross-tier duplicate `(popup_id, user_id)` /
`(popup_id)` exists across ALL rows regardless of flow. A collision would
mean flow-scoped rows now conflict with the popup-shared tier once the flow
dimension collapses away; downgrading on top of that would either corrupt
data or fail with an opaque `IntegrityError`. This migration NEVER deletes
rows to resolve it — it raises and leaves every column/constraint
untouched.

Revision ID: 9bf2a7a71d10
Revises: 597d9a2019ba
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "9bf2a7a71d10"
down_revision = "597d9a2019ba"
branch_labels = None
depends_on = None

_TABLES = ("popupreviewers", "approvalstrategies")


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

    op.drop_constraint("uq_popup_reviewer", "popupreviewers", type_="unique")
    op.create_index(
        "uq_popup_reviewer_flow",
        "popupreviewers",
        ["sales_flow_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        "uq_popup_reviewer_popup_shared",
        "popupreviewers",
        ["popup_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    op.drop_constraint(
        "uq_approval_strategy_popup", "approvalstrategies", type_="unique"
    )
    op.drop_index("ix_approvalstrategies_popup_id", table_name="approvalstrategies")
    op.create_index(
        "uq_approval_strategy_flow",
        "approvalstrategies",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        "uq_approval_strategy_popup_shared",
        "approvalstrategies",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )


def downgrade() -> None:
    conn = op.get_bind()

    reviewer_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id, user_id FROM popupreviewers "
            "  GROUP BY popup_id, user_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if reviewer_duplicates:
        raise RuntimeError(
            "add_flow_id_reviewers downgrade aborted: "
            f"{reviewer_duplicates} duplicate (popup_id, user_id) pair(s) in "
            "popup_reviewers have more than one row across different sales "
            "flows. Downgrading would corrupt data — this migration NEVER "
            "deletes rows. Resolve or manually re-point the extra "
            "flow-scoped reviewer(s) for the affected popup(s) before "
            "downgrading."
        )

    strategy_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id FROM approvalstrategies "
            "  GROUP BY popup_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if strategy_duplicates:
        raise RuntimeError(
            "add_flow_id_reviewers downgrade aborted: "
            f"{strategy_duplicates} popup(s) have more than one approval "
            "strategy across different sales flows. Downgrading would "
            "corrupt data — this migration NEVER deletes rows. Resolve or "
            "manually re-point the extra flow-scoped strategy(ies) for the "
            "affected popup(s) before downgrading."
        )

    op.drop_index("uq_approval_strategy_popup_shared", table_name="approvalstrategies")
    op.drop_index("uq_approval_strategy_flow", table_name="approvalstrategies")
    op.create_index(
        "ix_approvalstrategies_popup_id",
        "approvalstrategies",
        ["popup_id"],
        unique=True,
    )
    op.create_unique_constraint(
        "uq_approval_strategy_popup", "approvalstrategies", ["popup_id"]
    )

    op.drop_index("uq_popup_reviewer_popup_shared", table_name="popupreviewers")
    op.drop_index("uq_popup_reviewer_flow", table_name="popupreviewers")
    op.create_unique_constraint(
        "uq_popup_reviewer", "popupreviewers", ["popup_id", "user_id"]
    )

    for table in reversed(_TABLES):
        op.drop_index(f"ix_{table}_sales_flow_id", table_name=table)
        op.drop_constraint(f"fk_{table}_sales_flow_id", table, type_="foreignkey")
        op.drop_column(table, "sales_flow_id")
