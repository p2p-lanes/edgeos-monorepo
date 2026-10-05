"""Badges: styles, catalog, per-style artwork, awards and public profile links.

SIM-108 phase 1. ``badge_awards`` already carries issuer_type/issuer_human_id
so peer sending (phase 2) and rule awards (phase 3) only add columns.
"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "b5d2e8a4c7f1"
down_revision = "e3b7a91c5d20"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "badge_styles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "key", name="uq_badge_styles_tenant_key"),
    )
    op.create_index("ix_badge_styles_tenant_id", "badge_styles", ["tenant_id"])
    op.create_index(
        "uq_badge_styles_tenant_default",
        "badge_styles",
        ["tenant_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "badges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("category", sa.String(100)),
        sa.Column(
            "style_override_id",
            sa.Uuid(),
            sa.ForeignKey("badge_styles.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "repeatable", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_badges_tenant_slug"),
    )
    op.create_index("ix_badges_tenant_id", "badges", ["tenant_id"])

    op.create_table(
        "badge_images",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "badge_id",
            sa.Uuid(),
            sa.ForeignKey("badges.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "style_id",
            sa.Uuid(),
            sa.ForeignKey("badge_styles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("image_url", sa.String(500), nullable=False),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.UniqueConstraint("badge_id", "style_id", name="uq_badge_images_badge_style"),
    )
    op.create_index("ix_badge_images_tenant_id", "badge_images", ["tenant_id"])

    op.create_table(
        "badge_awards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "badge_id",
            sa.Uuid(),
            sa.ForeignKey("badges.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_human_id",
            sa.Uuid(),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("issuer_type", sa.String(20), nullable=False),
        sa.Column("issuer_user_id", sa.Uuid()),
        sa.Column(
            "issuer_human_id",
            sa.Uuid(),
            sa.ForeignKey("humans.id", ondelete="SET NULL"),
        ),
        sa.Column("issuer_name", sa.String(255)),
        sa.Column(
            "popup_id", sa.Uuid(), sa.ForeignKey("popups.id", ondelete="SET NULL")
        ),
        sa.Column("message", sa.Text()),
        sa.Column("is_unique", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_by_user_id", sa.Uuid()),
        sa.Column("revoke_reason", sa.Text()),
        sa.CheckConstraint(
            "issuer_type IN ('admin', 'human', 'rule')",
            name="ck_badge_awards_issuer_type",
        ),
        sa.CheckConstraint(
            "issuer_type <> 'admin' OR issuer_user_id IS NOT NULL",
            name="ck_badge_awards_admin_issuer",
        ),
        sa.CheckConstraint(
            "issuer_type <> 'human' OR issuer_human_id IS NOT NULL",
            name="ck_badge_awards_human_issuer",
        ),
    )
    op.create_index("ix_badge_awards_tenant_id", "badge_awards", ["tenant_id"])
    op.create_index("ix_badge_awards_badge", "badge_awards", ["badge_id"])
    op.create_index(
        "ix_badge_awards_recipient",
        "badge_awards",
        ["recipient_human_id", "revoked_at"],
    )
    op.create_index(
        "ix_badge_awards_issuer_human",
        "badge_awards",
        ["issuer_human_id", "awarded_at"],
    )
    op.create_index(
        "uq_badge_awards_active_unique",
        "badge_awards",
        ["badge_id", "recipient_human_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL AND is_unique"),
    )

    for table in ("badge_styles", "badges", "badge_images", "badge_awards"):
        add_tenant_table_permissions(table)

    op.add_column(
        "humans", sa.Column("public_profile_token", sa.String(64), nullable=True)
    )
    op.add_column(
        "humans",
        sa.Column(
            "public_profile_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.create_unique_constraint(
        "uq_humans_public_profile_token", "humans", ["public_profile_token"]
    )


def downgrade():
    op.drop_constraint("uq_humans_public_profile_token", "humans", type_="unique")
    op.drop_column("humans", "public_profile_enabled")
    op.drop_column("humans", "public_profile_token")

    for table in ("badge_awards", "badge_images", "badges", "badge_styles"):
        remove_tenant_table_permissions(table)
        op.drop_table(table)
