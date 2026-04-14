"""Allow reuse of deleted user email

Revision ID: a1b2c3d4e5f6
Revises: 086f8872b3fb
Create Date: 2025-07-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '086f8872b3fb'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the old absolute unique constraint (blocks reuse of deleted emails)
    op.drop_constraint('uq_user_email_tenant_id', 'users', type_='unique')

    # Drop the old non-unique partial index
    op.drop_index('ix_users_active', table_name='users')

    # Create a partial unique index: email+tenant_id must be unique ONLY among
    # non-deleted users. This allows a new user to reuse an email that belongs
    # to a soft-deleted record.
    op.create_index(
        'uq_user_email_tenant_id_active',
        'users',
        ['email', 'tenant_id'],
        unique=True,
        postgresql_where=sa.text('deleted = false'),
    )


def downgrade():
    op.drop_index('uq_user_email_tenant_id_active', table_name='users')

    op.create_index(
        'ix_users_active',
        'users',
        ['email'],
        postgresql_where=sa.text('deleted = false'),
    )

    op.create_unique_constraint(
        'uq_user_email_tenant_id', 'users', ['email', 'tenant_id']
    )
