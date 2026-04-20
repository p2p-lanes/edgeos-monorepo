"""add_date_range_to_form_fields

Revision ID: 499dd4b24f32
Revises: b3d7f2a9e1c8
Create Date: 2026-04-20 19:25:12.758063

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '499dd4b24f32'
down_revision = 'b3d7f2a9e1c8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('formfields', sa.Column('min_date', sa.String(), nullable=True))
    op.add_column('formfields', sa.Column('max_date', sa.String(), nullable=True))


def downgrade():
    op.drop_column('formfields', 'max_date')
    op.drop_column('formfields', 'min_date')
