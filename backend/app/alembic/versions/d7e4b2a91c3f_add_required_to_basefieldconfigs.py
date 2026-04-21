"""Add required column to basefieldconfigs and backfill from the catalog.

The `required` flag becomes per-popup configurable (used to be hardcoded
in BASE_FIELD_DEFINITIONS). Backfill existing rows with the catalog's
default so behavior stays identical post-upgrade.

Revision ID: d7e4b2a91c3f
Revises: a5f3c8e2d1b9
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d7e4b2a91c3f"
down_revision: str = "a5f3c8e2d1b9"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# Fields that default to required in the catalog. Kept inline so the
# migration stays self-contained and stable across future catalog edits.
REQUIRED_FIELDS = (
    "first_name",
    "last_name",
    "telegram",
    "residence",
    "gender",
    "age",
)


def upgrade() -> None:
    op.add_column(
        "basefieldconfigs",
        sa.Column(
            "required",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    op.execute(
        sa.text(
            "UPDATE basefieldconfigs SET required = true "
            "WHERE field_name = ANY(:field_names)"
        ).bindparams(
            sa.bindparam("field_names", list(REQUIRED_FIELDS), type_=sa.ARRAY(sa.String))
        )
    )


def downgrade() -> None:
    op.drop_column("basefieldconfigs", "required")
