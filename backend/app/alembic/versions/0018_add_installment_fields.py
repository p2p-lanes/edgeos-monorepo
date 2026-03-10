"""Add installment plan fields to payments and payment_installments table.

Revision ID: 0018_add_installments
Revises: f02d72b54ad3
Create Date: 2026-03-06

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "0018_add_installments"
down_revision = "f02d72b54ad3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add installment fields to payments table
    op.add_column(
        "payments",
        sa.Column("is_installment_plan", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "payments",
        sa.Column("installments_total", sa.Integer(), nullable=True),
    )
    op.add_column(
        "payments",
        sa.Column("installments_paid", sa.Integer(), nullable=True, server_default="0"),
    )

    # Create payment_installments table
    op.create_table(
        "payment_installments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("payment_id", UUID(as_uuid=True), sa.ForeignKey("payments.id"), nullable=False),
        sa.Column("external_payment_id", sa.String(), nullable=False),
        sa.Column("installment_number", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(), nullable=False, server_default="USD"),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_payment_installments_tenant_id", "payment_installments", ["tenant_id"])
    op.create_index("ix_payment_installments_payment_id", "payment_installments", ["payment_id"])

    # Enable RLS on payment_installments
    op.execute("ALTER TABLE payment_installments ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY tenant_isolation ON payment_installments "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON payment_installments")
    op.execute("ALTER TABLE payment_installments DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_payment_installments_payment_id", table_name="payment_installments")
    op.drop_index("ix_payment_installments_tenant_id", table_name="payment_installments")
    op.drop_table("payment_installments")
    op.drop_column("payments", "installments_paid")
    op.drop_column("payments", "installments_total")
    op.drop_column("payments", "is_installment_plan")
