"""Add additional_data JSONB column to attendees.

Adds a per-attendee free-form blob that persists the answers to a category's
declarative ``required_fields`` (e.g. a kid's ``date_of_birth``). Mirrors
``applications.custom_fields`` but at the per-attendee level so each attendee
row carries its own answers.

Existing rows default to an empty object; no behavior change until callers
start populating it.

Revision ID: d4e8f1a92b67
Revises: c7a4e9f2d815
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4e8f1a92b67"
down_revision: str | Sequence[str] | None = "c7a4e9f2d815"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "attendees",
        sa.Column(
            "additional_data",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("attendees", "additional_data")
