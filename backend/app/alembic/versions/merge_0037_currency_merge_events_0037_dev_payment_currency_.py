"""merge events 0037 + dev payment currency heads

Revision ID: merge_0037_currency
Revises: 0037_multi_slot_weekly_hours, 9b1f9c8e4d2a
Create Date: 2026-04-17 16:51:33.409746

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'merge_0037_currency'
down_revision = ('0037_multi_slot_weekly_hours', '9b1f9c8e4d2a')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
