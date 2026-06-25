"""Rename humans.rating default value from 'sin_calificar' to 'unrated'.

This migration renames the neutral/default rating value stored in the ``humans``
table from the Spanish string ``sin_calificar`` to the English string ``unrated``.
All application code and the ``HumanRating`` enum have been updated in the same
release.

NOTE: This is a non-backward-compatible value change. The pipeline runs the
migration before the new code is deployed, so during the deploy window the
previous code is still live. That code's ``HumanRating`` enum only knows
``'sin_calificar'``; reading a row already migrated to ``'unrated'`` fails
Pydantic enum validation and returns 500 on humans reads (``/humans/me``,
listings, etc.) for the duration of the window. This transient risk is
knowingly accepted. The proper zero-downtime path would teach the code to
tolerate both values in a prior release before flipping the stored value.

Revision ID: fc6890fea75f
Revises:     b8d2f3a47c19
Create Date: 2026-06-23
"""

from alembic import op
import sqlalchemy as sa

revision = "fc6890fea75f"
down_revision = "b8d2f3a47c19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE humans SET rating = 'unrated' WHERE rating = 'sin_calificar'")
    op.alter_column(
        "humans",
        "rating",
        existing_type=sa.String(20),
        server_default="unrated",
    )


def downgrade() -> None:
    op.alter_column(
        "humans",
        "rating",
        existing_type=sa.String(20),
        server_default="sin_calificar",
    )
    op.execute("UPDATE humans SET rating = 'sin_calificar' WHERE rating = 'unrated'")
