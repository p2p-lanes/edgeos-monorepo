"""give each flow its own answer on attendee links

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 5.

This one was blocked until dev's `a3f8c1d94e27` landed. A referral used to be
its own table with no flow, so `referrals_enabled` had nothing to hang on.
Now a referral IS an invite — `is_portal_created` tells them apart — and an
invite has named its flow since the re-key. The flag can finally sit where the
thing it governs already lives.

`max_referrals_per_attendee` travels with it: the ceiling and the switch are
one decision, and a door that shares differently shares at its own rate.

Each flow takes a copy of what its popup had, so nothing changes for anyone on
the day this runs.

Idempotent: only flow columns that are NULL are filled.

Revision ID: e2b6a90d4c17
Revises: d5a81c4e7b60
Create Date: 2026-08-13 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e2b6a90d4c17"
down_revision = "d5a81c4e7b60"
branch_labels = None
depends_on = None

# Mirrors the new entries in app.api.sales_flow.schemas.EFFECTIVE_CONFIG_FIELDS.
# Duplicated rather than imported: a migration must not depend on application
# code that can change shape after it ships.
COLUMNS: tuple[tuple[str, sa.types.TypeEngine], ...] = (
    ("referrals_enabled", sa.Boolean()),
    ("max_referrals_per_attendee", sa.Integer()),
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
