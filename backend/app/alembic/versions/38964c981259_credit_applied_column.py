"""Add payments.credit_applied column for credit debit/restore tracking.

Records the exact credit amount deducted from applications.credit at payment
creation (the debit). Used by the restore-on-expire/cancel path in update_status
to return exactly the right amount back to the application balance.

Both tables (payments, applications) already have Row-Level Security in place.
Adding a column to an existing table does not require add_tenant_table_permissions.

Revision ID: 38964c981259
Revises: c4a7e9b21d6f
Create Date: 2026-06-30
"""

import sqlalchemy as sa
from alembic import op

revision: str = "38964c981259"
down_revision: str = "c4a7e9b21d6f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column(
            "credit_applied",
            sa.Numeric(10, 2),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("payments", "credit_applied")
