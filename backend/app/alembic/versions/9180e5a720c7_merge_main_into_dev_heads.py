"""merge_main_into_dev_heads

Revision ID: 9180e5a720c7
Revises: 0041_events_require_approval, 8b1f6e2c4d7a
Create Date: 2026-04-29 17:05:17.241299

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '9180e5a720c7'
down_revision = ('0041_events_require_approval', '8b1f6e2c4d7a')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
