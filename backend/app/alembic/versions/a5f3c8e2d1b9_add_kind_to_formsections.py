"""Add kind column to formsections for section type differentiation.

Differentiates standard sections (ordinary groups of fields) from
special-behavior sections (companions, scholarship). The portal uses kind
to decide how to render a section; the backoffice uses it to gate which
kinds are available to add based on popup feature flags.

Revision ID: a5f3c8e2d1b9
Revises: b4f2a9c1e803
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5f3c8e2d1b9"
down_revision: str = "b4f2a9c1e803"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "formsections",
        sa.Column(
            "kind",
            sa.String(32),
            nullable=False,
            server_default="standard",
        ),
    )

    # Backfill kind for seeded sections. Protected flag guards against
    # user-created sections that happen to share a label.
    op.execute(
        """
        UPDATE formsections
        SET kind = 'companions'
        WHERE label = 'Children and +1s' AND protected = true
        """
    )
    op.execute(
        """
        UPDATE formsections
        SET kind = 'scholarship'
        WHERE label = 'Scholarship' AND protected = true
        """
    )


def downgrade() -> None:
    op.drop_column("formsections", "kind")
