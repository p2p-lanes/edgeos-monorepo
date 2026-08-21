"""Add latest admin status-override metadata to applications.

Revision ID: c4f1a2b3d5e6
Revises: c4d8e6f1a2b3
Create Date: 2026-03-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4f1a2b3d5e6"
down_revision: str | None = "c4d8e6f1a2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "applications", sa.Column("status_override_reason", sa.Text(), nullable=True)
    )
    op.add_column(
        "applications",
        sa.Column("status_overridden_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column(
            "status_overridden_by_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "applications",
        sa.Column("status_overridden_by_name", sa.String(), nullable=True),
    )
    op.add_column(
        "applications",
        sa.Column("status_overridden_by_email", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("applications", "status_overridden_by_email")
    op.drop_column("applications", "status_overridden_by_name")
    op.drop_column("applications", "status_overridden_by_user_id")
    op.drop_column("applications", "status_overridden_at")
    op.drop_column("applications", "status_override_reason")
