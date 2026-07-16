"""Add applications.fee_credit_granted column for idempotent fee-to-credit grant.

Tracks whether the application fee has already been converted to portal credit
for this application. Boolean NOT NULL DEFAULT false so existing rows start
with fee_credit_granted=false (no grant has been issued yet).

Both tables (applications, payments) already have Row-Level Security in place.
Adding a column to an existing table does not require add_tenant_table_permissions.

Revision ID: 70b397330323
Revises: 38964c981259
Create Date: 2026-07-01
"""

import sqlalchemy as sa
from alembic import op

revision: str = "70b397330323"
down_revision: str = "9afa5db2f4cd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column(
            "fee_credit_granted",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("applications", "fee_credit_granted")
