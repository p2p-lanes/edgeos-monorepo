"""drop unused anonymous cart email index

Open-checkout carts are now keyed by (human, popup) like authenticated carts,
so no cart has human_id NULL and the partial unique index on (tenant, popup,
email) matches nothing. Drop it; uq_cart_human_popup enforces uniqueness.

Revision ID: e266b8601d0c
Revises: d4f7b2a9c1e6
Create Date: 2026-07-16 09:59:23.254711

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e266b8601d0c'
down_revision = 'd4f7b2a9c1e6'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index("uq_cart_tenant_popup_email", table_name="carts")


def downgrade():
    op.create_index(
        "uq_cart_tenant_popup_email",
        "carts",
        ["tenant_id", "popup_id", "email"],
        unique=True,
        postgresql_where=sa.text("human_id IS NULL"),
    )
