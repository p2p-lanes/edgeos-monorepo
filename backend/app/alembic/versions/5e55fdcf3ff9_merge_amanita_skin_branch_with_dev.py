"""merge amanita skin branch with dev

Revision ID: 5e55fdcf3ff9
Revises: 70e815ed504e, d4f7b2a9c1e6
Create Date: 2026-07-15 12:13:07.677984

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '5e55fdcf3ff9'
down_revision = ('70e815ed504e', 'd4f7b2a9c1e6')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
