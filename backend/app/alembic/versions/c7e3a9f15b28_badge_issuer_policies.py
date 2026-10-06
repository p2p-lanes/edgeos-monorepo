"""Badge issuer policies: who besides admins can give which badges, and how many.

SIM-108 phase 2. A policy covers one or more badges that share one allowance,
an audience (listed humans, a popup's attendees or the whole tenant) and a
reset window. Peer awards record the policy they were counted against.
"""

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "c7e3a9f15b28"
down_revision = "b5d2e8a4c7f1"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "badge_issuer_policies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("audience_type", sa.String(32), nullable=False),
        sa.Column(
            "popup_id", sa.Uuid(), sa.ForeignKey("popups.id", ondelete="CASCADE")
        ),
        sa.Column("allowance_quantity", sa.Integer()),
        sa.Column("allowance_window", sa.String(16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "audience_type IN ('humans', 'popup_attendees', 'tenant')",
            name="ck_badge_issuer_policies_audience",
        ),
        sa.CheckConstraint(
            "allowance_window IN ('day', 'week', 'popup', 'lifetime')",
            name="ck_badge_issuer_policies_window",
        ),
        sa.CheckConstraint(
            "(audience_type <> 'popup_attendees' AND allowance_window <> 'popup')"
            " OR popup_id IS NOT NULL",
            name="ck_badge_issuer_policies_popup",
        ),
        sa.CheckConstraint(
            "allowance_quantity IS NULL OR allowance_quantity > 0",
            name="ck_badge_issuer_policies_quantity",
        ),
    )
    op.create_index(
        "ix_badge_issuer_policies_tenant_id", "badge_issuer_policies", ["tenant_id"]
    )

    op.create_table(
        "badge_issuer_policy_badges",
        sa.Column(
            "policy_id",
            sa.Uuid(),
            sa.ForeignKey("badge_issuer_policies.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "badge_id",
            sa.Uuid(),
            sa.ForeignKey("badges.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
    )
    op.create_index(
        "ix_badge_issuer_policy_badges_tenant_id",
        "badge_issuer_policy_badges",
        ["tenant_id"],
    )

    op.create_table(
        "badge_issuer_policy_humans",
        sa.Column(
            "policy_id",
            sa.Uuid(),
            sa.ForeignKey("badge_issuer_policies.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "human_id",
            sa.Uuid(),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
    )
    op.create_index(
        "ix_badge_issuer_policy_humans_tenant_id",
        "badge_issuer_policy_humans",
        ["tenant_id"],
    )

    for table in (
        "badge_issuer_policies",
        "badge_issuer_policy_badges",
        "badge_issuer_policy_humans",
    ):
        add_tenant_table_permissions(table)

    op.add_column(
        "badge_awards",
        sa.Column(
            "policy_id",
            sa.Uuid(),
            sa.ForeignKey("badge_issuer_policies.id", ondelete="SET NULL"),
        ),
    )
    op.create_index(
        "ix_badge_awards_policy_issuer",
        "badge_awards",
        ["policy_id", "issuer_human_id", "awarded_at"],
    )


def downgrade():
    op.drop_index("ix_badge_awards_policy_issuer", table_name="badge_awards")
    op.drop_column("badge_awards", "policy_id")
    for table in (
        "badge_issuer_policy_humans",
        "badge_issuer_policy_badges",
        "badge_issuer_policies",
    ):
        remove_tenant_table_permissions(table)
        op.drop_table(table)
