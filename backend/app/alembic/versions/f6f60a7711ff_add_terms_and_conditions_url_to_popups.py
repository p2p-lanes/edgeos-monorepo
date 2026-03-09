"""add terms_and_conditions_url to popups

Revision ID: f6f60a7711ff
Revises: 0018_add_installments
Create Date: 2026-03-09 14:27:54.690676

"""
from alembic import op
import sqlmodel.sql.sqltypes
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f6f60a7711ff'
down_revision = '0018_add_installments'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('popups', sa.Column('terms_and_conditions_url', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade():
    op.drop_column('popups', 'terms_and_conditions_url')
