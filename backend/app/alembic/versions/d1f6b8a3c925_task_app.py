"""task app

Adds tasks.app (varchar(16), nullable, indexed): the optional surface a task
relates to — "portal" | "backoffice". NULL means unspecified.

Revision ID: d1f6b8a3c925
Revises: c9e4a1b7d260
Create Date: 2026-06-05
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d1f6b8a3c925"
down_revision = "c9e4a1b7d260"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("app", sa.String(length=16), nullable=True))
    op.create_index(op.f("ix_tasks_app"), "tasks", ["app"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_tasks_app"), table_name="tasks")
    op.drop_column("tasks", "app")
