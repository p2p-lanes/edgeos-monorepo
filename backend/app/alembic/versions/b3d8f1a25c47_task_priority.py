"""add priority to tasks

Adds a `priority` column (low | medium | high) to the tasks table. Existing
rows backfill to 'medium' via the server_default.

Revision ID: b3d8f1a25c47
Revises: e7d2b9f4a6c1
Create Date: 2026-06-03

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b3d8f1a25c47"
down_revision = "e7d2b9f4a6c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "priority",
            sa.String(length=16),
            nullable=False,
            server_default="medium",
        ),
    )
    op.create_index("ix_tasks_priority", "tasks", ["priority"])


def downgrade() -> None:
    op.drop_index("ix_tasks_priority", table_name="tasks")
    op.drop_column("tasks", "priority")
