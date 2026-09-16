"""Backfill application-fee payment sales flow provenance.

Historical application-fee payments created after sales-flow support did not
record a sales flow. Associate only those unassigned rows with their popup's
default flow. Existing associations and non-fee payments are left unchanged.

Downgrade is deliberately a no-op. Once assigned, a historical row is
indistinguishable from one corrected by an operator, so clearing the value
would risk deleting valid provenance.

Revision ID: 9c7a4e2f1b8d
Revises: d9e4c2a7b6f1
"""

import sqlalchemy as sa
from alembic import op

revision = "9c7a4e2f1b8d"
down_revision = "d9e4c2a7b6f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE payments AS payment "
            "SET sales_flow_id = flow.id "
            "FROM sales_flows AS flow "
            "WHERE payment.payment_type = 'application_fee' "
            "AND payment.sales_flow_id IS NULL "
            "AND flow.popup_id = payment.popup_id "
            "AND flow.tenant_id = payment.tenant_id "
            "AND flow.is_default IS TRUE"
        )
    )


def downgrade() -> None:
    pass
