"""merge main into dev

Revision ID: 439d14566eae
Revises: 0041_events_require_approval, 3f8a1c9e4b2d
Create Date: 2026-05-04 10:08:08.239601

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '439d14566eae'
down_revision = ('0041_events_require_approval', '3f8a1c9e4b2d')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
