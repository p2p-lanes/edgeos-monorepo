"""Rename display_variant to template; add template_config JSONB column.

Revision ID: 0024_rename_display_variant_to_template
Revises: 0023_add_step_watermark
Create Date: 2026-03-31

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0024_rename_to_template"
down_revision = "0023_add_step_watermark"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "ticketingsteps", "display_variant", new_column_name="template"
    )
    op.add_column(
        "ticketingsteps", sa.Column("template_config", JSONB, nullable=True)
    )

    # Backfill default template_config for ticket-select steps
    op.execute("""
        UPDATE ticketingsteps
        SET template_config = '{
            "sections": [
                {"key": "full", "label": "Full Passes", "order": 0, "product_ids": []},
                {"key": "month", "label": "Month Pass", "order": 1, "product_ids": []},
                {"key": "week", "label": "Weekly Passes", "order": 2, "product_ids": []},
                {"key": "day", "label": "Day Passes", "order": 3, "product_ids": []}
            ]
        }'::jsonb
        WHERE template = 'ticket-select'
    """)


def downgrade() -> None:
    op.drop_column("ticketingsteps", "template_config")
    op.alter_column(
        "ticketingsteps", "template", new_column_name="display_variant"
    )
