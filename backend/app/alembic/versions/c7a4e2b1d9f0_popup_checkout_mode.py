"""add popup checkout mode

Revision ID: c7a4e2b1d9f0
Revises: 9b1f9c8e4d2a
Create Date: 2026-04-17 17:15:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c7a4e2b1d9f0"
down_revision = "9b1f9c8e4d2a"
branch_labels = None
depends_on = None


def backfill_checkout_mode(
    connection: sa.engine.Connection, table_name: str = "popups"
) -> None:
    connection.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET checkout_mode = CASE
                WHEN sale_type = 'direct' THEN 'simple_quantity'
                ELSE 'pass_system'
            END
            WHERE checkout_mode IS NULL
            """
        )
    )


def upgrade() -> None:
    op.add_column(
        "popups",
        sa.Column(
            "checkout_mode",
            sa.String(),
            nullable=True,
            server_default="pass_system",
        ),
    )
    backfill_checkout_mode(op.get_bind())
    op.alter_column("popups", "checkout_mode", nullable=False)


def downgrade() -> None:
    op.drop_column("popups", "checkout_mode")
