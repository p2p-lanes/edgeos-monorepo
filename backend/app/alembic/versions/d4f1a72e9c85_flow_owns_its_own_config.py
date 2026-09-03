"""give each flow its own copy of the popup's channel configuration

Design: sdd/sales-flows-rediseno slice 7 — the last inheritance left. The
Class B columns (application layout and fee, scholarship and incentive
toggles, coupon toggle, checkout redirects, reminder cadences) live on both
`popups` and `sales_flows`, and `build_effective_config` reads the flow's
value when set, else the popup's. A NULL therefore means "ask the popup",
which is the same absent-row-means-something shape every other slice
removed — and it is what forced an operator to answer, field by field,
eighteen inherit-or-override questions before a flow existed.

Each flow takes its own copy of whatever it was already reading, so nothing
changes for anyone on the day this runs: a flow that inherited value X now
stores value X. What changes is afterwards — editing one flow no longer
reaches another, and the eighteen toggles become eighteen plain fields.

`open_checkout_signing_secret` is copied like the rest. Flows start sharing
the popup's secret and can diverge later, which is the same trajectory as
every other column here.

The popup columns are deliberately left in place. Dropping them is a
separate change, once this backfill has been exercised, and the backoffice
has to stop offering them at popup level first — a popup field that silently
stops affecting anything is worse than the inheritance it replaced.

Idempotent: only flow columns that are NULL are filled, so re-running is a
no-op. A flow whose value was deliberately set stays as it is.

Downgrade is deliberately a no-op: a filled column is indistinguishable
from one an operator set on purpose after the backfill.

Revision ID: d4f1a72e9c85
Revises: c9e2f4b71d38
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d4f1a72e9c85"
down_revision = "c9e2f4b71d38"
branch_labels = None
depends_on = None

# Mirrors app.api.sales_flow.schemas.EFFECTIVE_CONFIG_FIELDS. Duplicated
# rather than imported: a migration must not depend on application code
# that can change shape after it ships.
CONFIG_COLUMNS: tuple[str, ...] = (
    "application_layout",
    "requires_application_fee",
    "application_fee_amount",
    "allows_scholarship",
    "allows_incentive",
    "allows_coupons",
    "open_checkout_success_url",
    "open_checkout_cancel_url",
    "open_checkout_signing_secret",
    "abandoned_cart_delay_days",
    "abandoned_cart_repeat_days",
    "abandoned_cart_max_count",
    "purchase_reminder_delay_days",
    "purchase_reminder_repeat_days",
    "purchase_reminder_max_count",
    "abandoned_application_delay_days",
    "abandoned_application_repeat_days",
    "abandoned_application_max_count",
)


def upgrade() -> None:
    conn = op.get_bind()

    assignments = ", ".join(
        f"{column} = COALESCE(f.{column}, p.{column})" for column in CONFIG_COLUMNS
    )
    conn.execute(
        sa.text(
            "UPDATE sales_flows AS f "  # noqa: S608 — column names are a fixed literal tuple
            f"SET {assignments} "
            "FROM popups p "
            "WHERE p.id = f.popup_id"
        )
    )

    # A flow still reading NULL where its popup has a value would silently
    # keep inheriting once the fallback is removed, so fail loudly instead.
    predicate = " OR ".join(
        f"(f.{column} IS NULL AND p.{column} IS NOT NULL)" for column in CONFIG_COLUMNS
    )
    remaining = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM sales_flows f "  # noqa: S608 — see above
            f"JOIN popups p ON p.id = f.popup_id WHERE {predicate}"
        )
    ).scalar()
    if remaining:
        raise RuntimeError(
            "flow_owns_its_own_config invariant violated: "
            f"{remaining} flow(s) still inherit at least one column"
        )


def downgrade() -> None:
    # Deliberate no-op — see module docstring.
    pass
