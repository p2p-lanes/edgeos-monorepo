"""add flow restriction rule

Design: sdd/sales-flows slice 12 (design D5/D6, G3 checkpoint 12.8 CONFIRMED
2026-08-04) — a nullable JSONB `restriction_rule` column on `sales_flows`
(Class C, flow-only). NULL means the restrictions feature is off for that
flow (unchanged behavior, matches every other cutover in this series' NULL
convention). No backfill: every existing flow gets NULL, i.e. no restriction
enforced, which is the pre-slice-12 status quo.

This column was originally scoped for slice 1's `create_sales_flows`
migration but DEFERRED (see `b79d252e79c2_create_sales_flows.py`) until the
evaluator/enforcement machinery that gives it meaning existed — adding an
inert column ahead of its consumer would have been dead surface area with no
test coverage possible at the time.

Revision ID: 9cd317fadfa5
Revises: 66d0a714e001
Create Date: 2026-08-04
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "9cd317fadfa5"
down_revision = "66d0a714e001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_flows",
        sa.Column("restriction_rule", JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sales_flows", "restriction_rule")
