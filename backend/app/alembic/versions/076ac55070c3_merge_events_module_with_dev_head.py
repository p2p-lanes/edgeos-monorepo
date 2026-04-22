"""merge events-module with dev head

Revision ID: 076ac55070c3
Revises: merge_0037_currency, 499dd4b24f32
Create Date: 2026-04-21 10:56:18.462459

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '076ac55070c3'
down_revision = ('merge_0037_currency', '499dd4b24f32')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
