"""popup contribution fee

Adds four contribution_* config columns to popups and contribution_amount
persistence column to payments. Single atomic migration for this feature.

Column-length rationale:
- contribution_label VARCHAR(255): matches popup string field convention
  (e.g., name: max_length=255 in PopupCreate).
- contribution_description TEXT: admin-authored copy, length-unbounded —
  matches PaymentProductBase.product_description: sa_type=Text() precedent.

No RLS changes: both tables already have RLS (existing tenant tables).
PostgreSQL 11+ handles ADD COLUMN ... NOT NULL DEFAULT <constant> without
a table rewrite for booleans, and nullable additions are always instant.

Revision ID: f6c1f50160ef
Revises: 3e8f4a2b1c5d
Create Date: 2026-05-21
"""

from alembic import op
import sqlalchemy as sa

revision: str = "f6c1f50160ef"
down_revision: str = "3e8f4a2b1c5d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Popup contribution config
    op.add_column(
        "popups",
        sa.Column(
            "contribution_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "contribution_percentage",
            sa.Numeric(precision=5, scale=2),
            nullable=True,
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "contribution_label",
            sa.String(length=255),
            nullable=True,
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "contribution_description",
            sa.Text(),
            nullable=True,
        ),
    )

    # Payment persistence
    op.add_column(
        "payments",
        sa.Column(
            "contribution_amount",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("payments", "contribution_amount")
    op.drop_column("popups", "contribution_description")
    op.drop_column("popups", "contribution_label")
    op.drop_column("popups", "contribution_percentage")
    op.drop_column("popups", "contribution_enabled")
