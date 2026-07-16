"""Rename popups.credits_enabled to popups.edit_passes_enabled.

The flag was repurposed during credit-decoupling: credit is now first-class
and always-on. The column now gates the edit-passes flow only.

Revision ID: 9afa5db2f4cd
Revises: 38964c981259
Create Date: 2026-06-30
"""

from alembic import op

revision: str = "9afa5db2f4cd"
down_revision: str = "38964c981259"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("popups", "credits_enabled", new_column_name="edit_passes_enabled")


def downgrade() -> None:
    op.alter_column("popups", "edit_passes_enabled", new_column_name="credits_enabled")
