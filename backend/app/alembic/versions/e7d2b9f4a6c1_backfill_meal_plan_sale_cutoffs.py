"""backfill Edge Esmeralda meal-plan order cutoffs into sale_ends_at

The "Week N Meal Plan" products had no ordering deadline, so late lunch orders
slipped through (the portal purchase path now enforces the sale window). The
business rule is that each week's lunches close the prior Friday at 11:59 PM
local time (America/Los_Angeles for Edge Esmeralda 2026).

This sets ``sale_ends_at`` to that precise instant for each of the four week
products. Timezone literals let Postgres resolve the correct UTC offset (PDT).
Scoped to specific product UUIDs, so it is a no-op in every other environment.

Revision ID: e7d2b9f4a6c1
Revises: c4e1a2f7b9d0
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e7d2b9f4a6c1"
down_revision = "c4e1a2f7b9d0"
branch_labels = None
depends_on = None

# (product_id, cutoff) — cutoff = Friday 11:59:59 PM PT before each week.
_CUTOFFS = [
    ("5b997ee3-e880-49e2-9af9-ec327cc9eb2d", "2026-05-29 23:59:59 America/Los_Angeles"),
    ("08df3f53-c076-4f29-a06b-a194e551571c", "2026-06-05 23:59:59 America/Los_Angeles"),
    ("49261740-32e4-46a1-a307-494af44b9bf3", "2026-06-12 23:59:59 America/Los_Angeles"),
    ("d14fe26e-8041-4adf-9d4f-09a3667b71bf", "2026-06-19 23:59:59 America/Los_Angeles"),
]


def upgrade() -> None:
    bind = op.get_bind()
    for product_id, cutoff in _CUTOFFS:
        bind.execute(
            sa.text(
                "UPDATE products SET sale_ends_at = CAST(:cutoff AS timestamptz) "
                "WHERE id = CAST(:pid AS uuid)"
            ),
            {"cutoff": cutoff, "pid": product_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for product_id, _ in _CUTOFFS:
        bind.execute(
            sa.text(
                "UPDATE products SET sale_ends_at = NULL WHERE id = CAST(:pid AS uuid)"
            ),
            {"pid": product_id},
        )
