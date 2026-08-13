"""Drop the referrals table

a3f8c1d94e27 copied every referral into `invites` and repointed
applications.referral_id at it. Nothing has read `referrals` since, and the API
and both frontends now speak the unified access-link vocabulary, so the table
goes.

applications.referral_id stays. Both attribution columns name a row in
`invites` and the pair records HOW someone entered: invite_id for a backoffice
link, referral_id for an attendee one. Collapsing them into one column would
push that distinction into a join for every report that asks it.

Revision ID: b8e2d7f45a19
Revises: a3f8c1d94e27
Create Date: 2026-08-06

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b8e2d7f45a19"
down_revision = "a3f8c1d94e27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Refuse to drop rows the copy never took. A referral missing from invites
    # means a3f8c1d94e27 did not complete, and dropping now would lose it.
    orphans = (
        op.get_bind()
        .exec_driver_sql(
            """
            SELECT count(*)
            FROM referrals r
            WHERE NOT EXISTS (SELECT 1 FROM invites i WHERE i.id = r.id)
            """
        )
        .scalar()
    )
    if orphans:
        raise RuntimeError(
            f"Refusing to drop referrals: {orphans} row(s) were never copied into "
            "invites. Re-run a3f8c1d94e27 before dropping."
        )

    op.drop_table("referrals")


def downgrade() -> None:
    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("referrer_human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column(
            "discount_percentage",
            sa.Numeric(5, 2),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "auto_approve", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "is_disabled", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("current_uses", sa.Integer(), nullable=False, server_default="0"),
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
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(["referrer_human_id"], ["humans.id"]),
        sa.UniqueConstraint("popup_id", "code", name="uq_referrals_popup_code"),
    )
    op.create_index("ix_referrals_referrer_human_id", "referrals", ["referrer_human_id"])
    op.create_index("ix_referrals_tenant_id", "referrals", ["tenant_id"])

    # Restore the rows from the links that carry a referrer.
    op.execute(
        """
        INSERT INTO referrals (
            id, tenant_id, popup_id, referrer_human_id, code, discount_percentage,
            auto_approve, is_disabled, max_uses, current_uses, expires_at,
            created_at, updated_at
        )
        SELECT
            i.id, i.tenant_id, i.popup_id, i.referrer_human_id, i.token,
            i.discount_percentage, i.auto_approve, i.is_disabled, i.max_uses,
            i.current_uses, i.expires_at, i.created_at, i.updated_at
        FROM invites i
        WHERE i.referrer_human_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
        """
    )
