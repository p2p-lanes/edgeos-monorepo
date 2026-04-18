"""Backfill formsections.kind for protected seeded sections.

Earlier seed paths (core/db.py:_seed_base_field_configs) created
companions/scholarship sections without setting the new `kind` column,
and the flag-gated defensive backfill (f9a2c4e6b3d8) skipped those
sections when the popup had the corresponding flag off — leaving legacy
rows stuck on kind='standard'. This migration updates the kind based
solely on label+protected, independent of current popup flags, so the
portal and the backoffice can consistently filter by kind.

Revision ID: c3b8a7d5e9f1
Revises: f9a2c4e6b3d8
Create Date: 2026-04-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3b8a7d5e9f1"
down_revision: str = "f9a2c4e6b3d8"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE formsections
        SET kind = 'companions'
        WHERE label = 'Children and +1s' AND protected = true AND kind = 'standard'
        """
    )
    op.execute(
        """
        UPDATE formsections
        SET kind = 'scholarship'
        WHERE label = 'Scholarship' AND protected = true AND kind = 'standard'
        """
    )


def downgrade() -> None:
    # No-op: the earlier migration (a5f3c8e2d1b9) left these rows as
    # 'standard' in the same environments, so reverting this migration
    # doesn't need to undo anything specific.
    pass
