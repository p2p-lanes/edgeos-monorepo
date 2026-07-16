"""open-checkout anonymous cart

Makes carts.human_id nullable and adds carts.email so open checkout (anonymous,
no logged-in human) can persist an abandoned cart keyed by email. Adds a partial
unique index (tenant_id, popup_id, email) WHERE human_id IS NULL so anonymous
carts are one-per-(popup, email) and never collide with authenticated carts
(which leave email NULL and rely on uq_cart_human_popup).

No RLS changes: carts already has RLS (existing tenant table). Adding a nullable
column and dropping NOT NULL are instant in PostgreSQL.

Revision ID: c4a7e9b21d6f
Revises: e7a1c93f2b6d
Create Date: 2026-06-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4a7e9b21d6f"
down_revision: str = "e7a1c93f2b6d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("carts", sa.Column("email", sa.String(), nullable=True))
    op.alter_column(
        "carts",
        "human_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    op.create_index(
        "uq_cart_tenant_popup_email",
        "carts",
        ["tenant_id", "popup_id", "email"],
        unique=True,
        postgresql_where=sa.text("human_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_cart_tenant_popup_email", table_name="carts")
    # Anonymous carts have no human; drop them before restoring NOT NULL.
    op.execute("DELETE FROM carts WHERE human_id IS NULL")
    op.alter_column(
        "carts",
        "human_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )
    op.drop_column("carts", "email")
