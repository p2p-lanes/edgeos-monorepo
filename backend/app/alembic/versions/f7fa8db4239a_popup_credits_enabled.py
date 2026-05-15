"""popup_credits_enabled: add popup-level toggle for credits feature.

Adds:
  - popups.credits_enabled (bool, NOT NULL, default false)

Defaults to false: existing popups do NOT have credits enabled until an admin
opts in per popup. Gates the credit logic in payment/crud.py and the credit UI
in portal.

Revision ID: f7fa8db4239a
Revises: c5d3e8a2f9b1
Create Date: 2026-05-15 17:17:22.765387

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7fa8db4239a"
down_revision: str = "c5d3e8a2f9b1"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "credits_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )


def downgrade() -> None:
    op.drop_column("popups", "credits_enabled")
