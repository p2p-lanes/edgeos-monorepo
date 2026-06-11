"""payments granted_by_user_id

Adds nullable payments.granted_by_user_id FK -> users.id (ON DELETE SET NULL)
so admin-granted free tickets can be distinguished from organic free payments
(100% coupons / zero credit). Indexed for "what did this admin grant?" lookups.

Revision ID: a8c1f02e5d33
Revises: 94d7d49c3c92
Create Date: 2026-05-27
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a8c1f02e5d33"
down_revision = "94d7d49c3c92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column(
            "granted_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_payments_granted_by_user_id",
        "payments",
        "users",
        ["granted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_payments_granted_by_user_id",
        "payments",
        ["granted_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_payments_granted_by_user_id", table_name="payments")
    op.drop_constraint("fk_payments_granted_by_user_id", "payments", type_="foreignkey")
    op.drop_column("payments", "granted_by_user_id")
