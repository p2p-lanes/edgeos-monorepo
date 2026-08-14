"""a popup's first flow says what it is instead of that it is the default

Design: sdd/sales-flows-rediseno. The flow every popup starts with was called
"Default", and that name reaches buyers: it is what the portal prints on the
door card next to Volunteers or Scholarship. "Default" describes the row's
place in the schema, not a way into a gathering, and a buyer choosing between
"Default" and "Volunteers" is being asked a question in our vocabulary.

It takes the name of what it does: `Attendee` for a flow that takes
applications, `Checkout` for one that sells directly.

Keyed on the flow's own `type`, not the popup's `sale_type`. That popup-level
split exists only because flows did not used to carry it, and it is on its way
out — a name derived from it would have to be derived again.

Only flows still called "Default" are renamed. An operator who already gave
theirs a name meant it, and this is a default, not a correction.

Revision ID: d5a81c4e7b60
Revises: c3d9f6e02a48
Create Date: 2026-08-13 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "d5a81c4e7b60"
down_revision = "c3d9f6e02a48"
branch_labels = None
depends_on = None

# Mirrors app.api.sales_flow.crud.DEFAULT_FLOW_NAMES. Duplicated rather than
# imported: a migration must not depend on application code that can change
# shape after it ships.
NAMES = (("application", "Attendee"), ("direct", "Checkout"))


def upgrade() -> None:
    for flow_type, name in NAMES:
        op.execute(
            f"""
            UPDATE sales_flows
            SET name = '{name}'
            WHERE is_default AND name = 'Default' AND type = '{flow_type}'
            """  # noqa: S608 — both values are from the module constant above
        )
    # An upsale flow is never a popup's default, but a row that got there some
    # other way should not keep a name that means nothing either.
    op.execute(
        "UPDATE sales_flows SET name = 'Checkout' "
        "WHERE is_default AND name = 'Default'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE sales_flows SET name = 'Default' "
        "WHERE is_default AND name IN ('Attendee', 'Checkout')"
    )
