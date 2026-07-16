"""merge tenant-smtp and human-telegram-links heads

Two independent feature branches each advanced the migration graph from a shared
ancestor and were never collapsed, leaving the tree with two heads:

  - ``d9e6f4b2a1c3`` (tenant SMTP settings)
  - ``d3a91f7c5e82`` (human_telegram_links) -> b8d2f3a47c19 (rich profiles)

``backend/scripts/prestart.sh`` runs ``alembic upgrade head`` (singular) with
``set -e`` on every boot, which errors out ("Multiple head revisions are present")
whenever more than one head exists — so this no-op merge restores a single head and
keeps deploys (dev and prod) able to upgrade cleanly. The work itself was applied by
the two parent migrations; there is nothing to do here.

Revision ID: e7a1c93f2b6d
Revises: d9e6f4b2a1c3, d3a91f7c5e82
Create Date: 2026-06-26
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "e7a1c93f2b6d"
down_revision: str | Sequence[str] | None = ("d9e6f4b2a1c3", "d3a91f7c5e82")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
