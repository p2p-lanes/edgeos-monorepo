"""merge companion types and venue slot booking

Revision ID: 42de2a61e52f
Revises: b03773f94f26, 0048_venue_slot_booking_mode
Create Date: 2026-05-14 16:22:14.340597

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '42de2a61e52f'
down_revision = ('b03773f94f26', '0048_venue_slot_booking_mode')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
