"""Add custom domain fields to tenants table.

Adds custom_domain and custom_domain_active columns to support per-tenant
custom domain routing in the portal. Custom domains give full portal access.

Revision ID: 0022_custom_domains
Revises: 0021_basefield_label
Create Date: 2026-03-30

"""

import sqlalchemy as sa
from alembic import op

revision = "0022_custom_domains"
down_revision = "0021_basefield_label"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tenants",
        sa.Column("custom_domain", sa.String(253), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column(
            "custom_domain_active",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    # Partial unique index: only enforces uniqueness on non-NULL values,
    # allowing multiple tenants to have NULL custom_domain.
    op.create_index(
        "ix_tenants_custom_domain",
        "tenants",
        ["custom_domain"],
        unique=True,
        postgresql_where=sa.text("custom_domain IS NOT NULL"),
    )


def downgrade():
    op.drop_index("ix_tenants_custom_domain", table_name="tenants")
    op.drop_column("tenants", "custom_domain_active")
    op.drop_column("tenants", "custom_domain")
