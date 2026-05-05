"""merge tenant email templates with events head

Revision ID: baa61e35a1e5
Revises: 076ac55070c3, 4f2b3c1d9e8a
Create Date: 2026-04-24 10:34:20.176313

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'baa61e35a1e5'
down_revision = ('076ac55070c3', '4f2b3c1d9e8a')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
