"""rekey application uniqueness to flow

Design: sdd/sales-flows slice 5 — human checkpoint G2 (confirmed 2026-08-04):
one application per person PER FLOW, not per popup. Drops
`uq_application_human_popup` and replaces it with `uq_application_human_flow`
on `(human_id, sales_flow_id)`.

NULL `sales_flow_id` rows (applications whose popup had no default flow at
creation time) are exempt from the new constraint by Postgres's own NULL
semantics: every NULL is treated as distinct in a unique index, so they
never collide with each other or with a real flow value. This is a
deliberate choice, not an oversight — see the module docstring of
`4e221ea1a2ee_add_flow_id_applications_payments.py` for why some rows may
still carry NULL after the slice-4 backfill.

Precondition (upgrade): before swapping constraints, verify zero rows
already share a non-NULL `(human_id, sales_flow_id)` pair. This should be
structurally guaranteed by the old `(human_id, popup_id)` constraint plus
the deterministic 1:1 popup -> default-flow backfill (slice 4), but is
asserted explicitly rather than assumed — mirrors every prior slice's own
invariant-check style. A violation aborts before either constraint is
touched.

Downgrade is the risky direction: restoring `(human_id, popup_id)`
uniqueness would silently corrupt data if a human now has two applications
across two different flows of the same popup — that is the entire point of
this slice (G2). Rather than delete one of the two rows (data loss, never
acceptable) or let `ADD CONSTRAINT` fail with an opaque `IntegrityError`,
downgrade explicitly counts cross-flow duplicates first and raises a
`RuntimeError` with an actionable operator message, leaving all data and
the new constraint untouched.

Revision ID: e31496bde92c
Revises: 4e221ea1a2ee
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e31496bde92c"
down_revision = "4e221ea1a2ee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Precondition: no existing (human_id, sales_flow_id) collision among
    # non-NULL sales_flow_id rows. A violation means the slice-4 backfill
    # or a later manual write produced inconsistent data — abort rather
    # than let the new unique constraint creation fail opaquely.
    colliding = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT human_id, sales_flow_id FROM applications "
            "  WHERE sales_flow_id IS NOT NULL "
            "  GROUP BY human_id, sales_flow_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if colliding:
        raise RuntimeError(
            "rekey_application_uniqueness_to_flow precondition violated: "
            f"{colliding} (human_id, sales_flow_id) pair(s) already have "
            "more than one application row"
        )

    op.drop_constraint("uq_application_human_popup", "applications", type_="unique")
    op.create_unique_constraint(
        "uq_application_human_flow", "applications", ["human_id", "sales_flow_id"]
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Cross-flow duplicates are the expected, intended outcome of this
    # slice (G2: one application per human per FLOW, not per popup).
    # Restoring the old (human_id, popup_id) constraint on top of that data
    # would either fail with an opaque IntegrityError or, worse, invite an
    # operator to "fix" it by deleting one of the rows. Neither is
    # acceptable — abort loudly and explain what to do instead.
    cross_flow_duplicates = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT human_id, popup_id FROM applications "
            "  GROUP BY human_id, popup_id HAVING COUNT(*) > 1"
            ") dupes"
        )
    ).scalar()
    if cross_flow_duplicates:
        raise RuntimeError(
            "rekey_application_uniqueness_to_flow downgrade aborted: "
            f"{cross_flow_duplicates} human(s) have more than one "
            "application in the same popup across different sales flows. "
            "Downgrading would corrupt data — this migration NEVER deletes "
            "rows. Resolve or manually re-point the extra per-flow "
            "application(s) for the affected popup(s) before downgrading."
        )

    op.drop_constraint("uq_application_human_flow", "applications", type_="unique")
    op.create_unique_constraint(
        "uq_application_human_popup", "applications", ["human_id", "popup_id"]
    )
