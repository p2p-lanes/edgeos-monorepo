"""add invoice fields to popups

Revision ID: 38aafddc6982
Revises: f6f60a7711ff
Create Date: 2026-03-09 14:34:17.855445

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes

# revision identifiers, used by Alembic.
revision = '38aafddc6982'
down_revision = 'f6f60a7711ff'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('popups', sa.Column('invoice_company_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('popups', sa.Column('invoice_company_address', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('popups', sa.Column('invoice_company_email', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade():
    op.drop_column('popups', 'invoice_company_email')
    op.drop_column('popups', 'invoice_company_address')
    op.drop_column('popups', 'invoice_company_name')
