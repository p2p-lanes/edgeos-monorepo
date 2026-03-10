"""add_image_url_to_products

Revision ID: f02d72b54ad3
Revises: 0017_add_companions
Create Date: 2026-03-05 14:50:24.140893

"""
from alembic import op
import sqlmodel.sql.sqltypes
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f02d72b54ad3'
down_revision = '0017_add_companions'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('products', sa.Column('image_url', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade():
    op.drop_column('products', 'image_url')
