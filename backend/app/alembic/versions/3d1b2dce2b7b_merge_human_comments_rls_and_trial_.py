"""merge human_comments_rls and trial_provisioning heads

Revision ID: 3d1b2dce2b7b
Revises: dd2e0f642142, f30eec99dce9
Create Date: 2026-07-22 12:19:47.185203

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = '3d1b2dce2b7b'
down_revision = ('dd2e0f642142', 'f30eec99dce9')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
