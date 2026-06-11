"""task archived_at

Adds tasks.archived_at (timestamptz, nullable, indexed). NULL means the task is
active (shown on the board); a timestamp means it was archived (hidden from the
board, kept for the record). Orthogonal to status — a published task can be
archived without changing its column.

Revision ID: c9e4a1b7d260
Revises: a7f3c2d8e1b4
Create Date: 2026-06-05
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c9e4a1b7d260"
down_revision = "a7f3c2d8e1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_tasks_archived_at"), "tasks", ["archived_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tasks_archived_at"), table_name="tasks")
    op.drop_column("tasks", "archived_at")
