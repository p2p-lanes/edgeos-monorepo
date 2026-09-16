"""backfill flow ownership of popup-shared configuration

Design: sdd/sales-flows-rediseno slice 1. `4a983282b8aa` gave every popup a
default sales_flow but left its CONFIGURATION in the popup-shared tier
(`sales_flow_id IS NULL`), reachable only through the read-time fallback in
`find_for_flow`. The redesign replaces that fallback with real ownership,
and this migration is the data half: every popup-shared configuration row is
re-pointed at its popup's default flow, so the rows the default flow serves
are rows it OWNS.

Read paths are deliberately untouched here. `find_for_flow` still resolves
flow-owned rows first and only falls back when a flow owns none, so a popup
whose sole flow is the default one behaves identically before and after.
Removing the fallback is slice 2's job, and it can only be done safely once
these rows exist.

Scope — the six configuration tables:

  ticketingsteps, formfields, formsections, basefieldconfigs,
  approvalstrategies, email_templates

`popupreviewers` is deliberately NOT among them. Its inheritance is
explicit — `sales_flows.reviewers_mode`, where 'inherit' resolves the popup
tier — so claiming those rows would empty the tier every inheriting flow
reads, silently leaving every application with no designated reviewer.
Reviewers stay at popup level.

`applications` is already covered by `4e221ea1a2ee`. `payments` and
`email_logs` are NOT touched: their `sales_flow_id` is provenance (which
flow produced this record), not configuration, and rewriting history would
be a lie. Tenant-scoped `email_templates` rows (`popup_id IS NULL`) are
skipped — they belong to no popup and therefore to no flow.

Which products a flow sells is not configuration and is not backfilled: it
is derived from the flow's own ticketing steps
(sdd/sales-flows-rediseno slice 4).

Partial unique indexes: each affected table splits its uniqueness across a
`sales_flow_id IS NULL` index and a `sales_flow_id IS NOT NULL` one. This
migration moves rows from the first to the second. No collision is possible:
every row of a given popup lands on that popup's single default flow, so a
key that was unique per popup stays unique per flow. The invariant check
below fails the transaction if any row was left behind.

Idempotent: only rows with `sales_flow_id IS NULL` are updated, so re-running
is a no-op.

Downgrade is deliberately a no-op. Setting these rows back to NULL would be
indistinguishable from rows an operator deliberately created as
default-flow-owned after this migration, and slice 2 makes the column NOT
NULL regardless. Mirrors `4a983282b8aa`'s downgrade contract.

Revision ID: b8e4c1d90a2f
Revises: 9cd317fadfa5
Create Date: 2026-08-05 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b8e4c1d90a2f"
down_revision = "9cd317fadfa5"
branch_labels = None
depends_on = None

# (table, extra predicate). Every table is keyed to its popup's default flow
# through `popup_id`; `email_templates` additionally carries tenant-scoped
# rows that have no popup and must be left alone.
CONFIG_TABLES: tuple[tuple[str, str], ...] = (
    ("ticketingsteps", ""),
    ("formfields", ""),
    ("formsections", ""),
    ("basefieldconfigs", ""),
    ("approvalstrategies", ""),
    ("email_templates", " AND t.popup_id IS NOT NULL"),
)


def upgrade() -> None:
    conn = op.get_bind()

    for table, extra in CONFIG_TABLES:
        conn.execute(
            sa.text(
                f"UPDATE {table} AS t "  # noqa: S608 — table names are a fixed literal tuple
                "SET sales_flow_id = f.id "
                "FROM sales_flows f "
                "WHERE f.popup_id = t.popup_id "
                "  AND f.is_default = true "
                f"  AND t.sales_flow_id IS NULL{extra}"
            )
        )

    # Every configuration row whose popup has a default flow must now be
    # owned by a flow. Anything left NULL would silently lose its
    # configuration the moment slice 2 removes the read-time fallback, so
    # fail the whole transaction instead.
    leftovers: list[str] = []
    for table, extra in CONFIG_TABLES:
        remaining = conn.execute(
            sa.text(
                f"SELECT COUNT(*) FROM {table} AS t "  # noqa: S608 — see above
                "JOIN sales_flows f "
                "  ON f.popup_id = t.popup_id AND f.is_default = true "
                f"WHERE t.sales_flow_id IS NULL{extra}"
            )
        ).scalar()
        if remaining:
            leftovers.append(f"{table}={remaining}")

    if leftovers:
        raise RuntimeError(
            "backfill_flow_config_ownership invariant violated: rows still "
            f"unowned after backfill ({', '.join(leftovers)})"
        )


def downgrade() -> None:
    # Deliberate no-op — see module docstring. Reverting to NULL cannot
    # distinguish backfilled rows from default-flow-owned rows created
    # afterwards.
    pass
