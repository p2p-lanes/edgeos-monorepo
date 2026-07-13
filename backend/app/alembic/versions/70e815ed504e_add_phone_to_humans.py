"""add phone to humans

Revision ID: 70e815ed504e
Revises: fa4a726d54b8
Create Date: 2026-07-13 10:53:00.022957

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '70e815ed504e'
down_revision = 'fa4a726d54b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("humans", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column(
        "humans", sa.Column("phone_country", sa.String(length=2), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("humans", "phone_country")
    op.drop_column("humans", "phone")
