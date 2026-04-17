"""merge events + translations heads

Revision ID: merge_0014_0034_events
Revises: 0014_add_translations_table, 0034_events_ical_sequence
Create Date: 2026-04-17 10:36:18.923029

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'merge_0014_0034_events'
down_revision = ('0014_add_translations_table', '0034_events_ical_sequence')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
