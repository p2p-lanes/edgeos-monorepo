"""Groups rework — DB foundation for invite/referral split + group-private events.

Adds new feature-flag columns to groups, popups, events, and applications.
Creates the invites and referrals tables with RLS.

EventVisibility enum unchanged — group-scoped privacy uses PRIVATE + group_id IS NOT NULL;
no ALTER on the visibility column. The EventVisibility Python enum stays at exactly
{PUBLIC, UNLISTED, PRIVATE}.

Revision ID: bfaabd563367
Revises: 84513cbb2260
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "bfaabd563367"
down_revision: str | Sequence[str] | None = "84513cbb2260"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. groups — new behaviour flags
    # ------------------------------------------------------------------
    op.add_column(
        "groups",
        sa.Column(
            "auto_approve_applications",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "express_checkout",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "enable_private_events",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ------------------------------------------------------------------
    # 2. popups — per-popup feature flags for the new capabilities
    # ------------------------------------------------------------------
    op.add_column(
        "popups",
        sa.Column(
            "invites_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "referrals_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "group_private_events_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ------------------------------------------------------------------
    # 3. invites table — token-based admin offer
    # ------------------------------------------------------------------
    op.create_table(
        "invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("recipient_email", sa.String(), nullable=True),
        sa.Column(
            "discount_percentage",
            sa.Numeric(5, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "auto_approve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "express_checkout",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column(
            "current_uses", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipient_human_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("redeemed_by_human_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "legacy_migrated_from_group_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["recipient_human_id"], ["humans.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["redeemed_by_human_id"], ["humans.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["legacy_migrated_from_group_id"], ["groups.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
    )
    # Unique index on (popup_id, token) — the natural lookup key
    op.create_index(
        "uq_invites_popup_token", "invites", ["popup_id", "token"], unique=True
    )
    # Partial unique index for idempotency guard on legacy data migration (PR-7)
    op.create_index(
        "uq_invites_legacy_group_id",
        "invites",
        ["legacy_migrated_from_group_id"],
        unique=True,
        postgresql_where=sa.text("legacy_migrated_from_group_id IS NOT NULL"),
    )
    # Supporting indexes
    op.create_index("ix_invites_tenant_id", "invites", ["tenant_id"])
    op.create_index(
        "ix_invites_popup_recipient_email", "invites", ["popup_id", "recipient_email"]
    )

    # Apply RLS for tenant isolation
    add_tenant_table_permissions("invites")

    # ------------------------------------------------------------------
    # 4. referrals table — human-driven ambassador code
    # ------------------------------------------------------------------
    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("referrer_human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column(
            "discount_percentage",
            sa.Numeric(5, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "auto_approve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column(
            "current_uses", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["referrer_human_id"], ["humans.id"], ondelete="RESTRICT"
        ),
    )
    # Unique index on (popup_id, code) — the natural lookup key
    op.create_index(
        "uq_referrals_popup_code", "referrals", ["popup_id", "code"], unique=True
    )
    # Supporting index
    op.create_index(
        "ix_referrals_referrer_human_id", "referrals", ["referrer_human_id"]
    )
    op.create_index("ix_referrals_tenant_id", "referrals", ["tenant_id"])

    # Apply RLS for tenant isolation
    add_tenant_table_permissions("referrals")

    # ------------------------------------------------------------------
    # 5. events — group_id FK (group-scoped private events)
    #    ON DELETE RESTRICT: prevents a group from being deleted while it
    #    still owns private events. Admin must clean up events first.
    # ------------------------------------------------------------------
    op.add_column(
        "events",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_events_group_id",
        "events",
        "groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # Partial index: only relevant for events that actually belong to a group
    op.create_index(
        "ix_events_group_start",
        "events",
        ["group_id", "start_time"],
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # 6. applications — invite_id and referral_id attribution columns
    #    Must come AFTER invites and referrals tables are created above.
    # ------------------------------------------------------------------
    op.add_column(
        "applications",
        sa.Column("invite_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_invite_id",
        "applications",
        "invites",
        ["invite_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_applications_invite_id",
        "applications",
        ["invite_id"],
        postgresql_where=sa.text("invite_id IS NOT NULL"),
    )

    op.add_column(
        "applications",
        sa.Column("referral_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_referral_id",
        "applications",
        "referrals",
        ["referral_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_applications_referral_id",
        "applications",
        ["referral_id"],
        postgresql_where=sa.text("referral_id IS NOT NULL"),
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # 1. applications — drop attribution columns first (FK dependencies)
    # ------------------------------------------------------------------
    op.drop_index("ix_applications_referral_id", table_name="applications")
    op.drop_constraint(
        "fk_applications_referral_id", "applications", type_="foreignkey"
    )
    op.drop_column("applications", "referral_id")

    op.drop_index("ix_applications_invite_id", table_name="applications")
    op.drop_constraint("fk_applications_invite_id", "applications", type_="foreignkey")
    op.drop_column("applications", "invite_id")

    # ------------------------------------------------------------------
    # 2. events — defensive null then drop group_id
    # ------------------------------------------------------------------
    op.execute("UPDATE events SET group_id = NULL WHERE group_id IS NOT NULL")
    op.drop_index("ix_events_group_start", table_name="events")
    op.drop_constraint("fk_events_group_id", "events", type_="foreignkey")
    op.drop_column("events", "group_id")

    # ------------------------------------------------------------------
    # 3. referrals — remove RLS then drop table
    # ------------------------------------------------------------------
    remove_tenant_table_permissions("referrals")
    op.drop_index("ix_referrals_tenant_id", table_name="referrals")
    op.drop_index("ix_referrals_referrer_human_id", table_name="referrals")
    op.drop_index("uq_referrals_popup_code", table_name="referrals")
    op.drop_table("referrals")

    # ------------------------------------------------------------------
    # 4. invites — remove RLS then drop table
    # ------------------------------------------------------------------
    remove_tenant_table_permissions("invites")
    op.drop_index("ix_invites_popup_recipient_email", table_name="invites")
    op.drop_index("ix_invites_tenant_id", table_name="invites")
    op.drop_index("uq_invites_legacy_group_id", table_name="invites")
    op.drop_index("uq_invites_popup_token", table_name="invites")
    op.drop_table("invites")

    # ------------------------------------------------------------------
    # 5. popups — drop feature flags
    # ------------------------------------------------------------------
    op.drop_column("popups", "group_private_events_enabled")
    op.drop_column("popups", "referrals_enabled")
    op.drop_column("popups", "invites_enabled")

    # ------------------------------------------------------------------
    # 6. groups — drop behaviour flags
    # ------------------------------------------------------------------
    op.drop_column("groups", "enable_private_events")
    op.drop_column("groups", "express_checkout")
    op.drop_column("groups", "auto_approve_applications")
