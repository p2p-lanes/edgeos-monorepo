"""Normalize legacy approval strategy values.

Revision ID: d4e8b1c7a2f9
Revises: 9c7a4e2f1b8d
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8b1c7a2f9"
down_revision: str = "9c7a4e2f1b8d"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE approvalstrategies "
            "SET strategy_type = upper(strategy_type) "
            "WHERE strategy_type IN ("
            "'auto_accept', 'any_reviewer', 'all_reviewers', "
            "'threshold', 'weighted'"
            ")"
        )
    )


def downgrade() -> None:
    # The ORM expected uppercase enum labels before this repair as well.
    pass
