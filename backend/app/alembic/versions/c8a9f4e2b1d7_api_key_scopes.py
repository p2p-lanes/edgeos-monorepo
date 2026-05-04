"""Add scopes to api_keys for least-privilege PAT authorization.

Revision ID: c8a9f4e2b1d7
Revises: 0041_events_require_approval
Create Date: 2026-04-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c8a9f4e2b1d7"
down_revision: str | None = "0041_events_require_approval"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "api_keys",
        sa.Column(
            "scopes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[\"events:read\", \"events:write\", \"rsvp:write\"]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("api_keys", "scopes")
