"""Badge rules: badges earned automatically from check-ins.

SIM-108 phase 3. A rule watches a metric (check-ins in a track's events, or
in any event of a popup) and awards its badge once the person reaches the
threshold. ``badge_awards.rule_id`` plus a partial unique index make each
rule award a person at most once, revoked awards included.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "d4f8b2c6e9a1"
down_revision = "c7e3a9f15b28"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "badge_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "badge_id",
            sa.Uuid(),
            sa.ForeignKey("badges.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("config", JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "type IN ('checkins_in_track', 'checkins_in_popup')",
            name="ck_badge_rules_type",
        ),
    )
    op.create_index("ix_badge_rules_tenant_id", "badge_rules", ["tenant_id"])
    add_tenant_table_permissions("badge_rules")

    op.add_column(
        "badge_awards",
        sa.Column(
            "rule_id",
            sa.Uuid(),
            sa.ForeignKey("badge_rules.id", ondelete="SET NULL"),
        ),
    )
    op.create_index(
        "uq_badge_awards_rule_recipient",
        "badge_awards",
        ["rule_id", "recipient_human_id"],
        unique=True,
        postgresql_where=sa.text("rule_id IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_badge_awards_rule_recipient", table_name="badge_awards")
    op.drop_column("badge_awards", "rule_id")
    remove_tenant_table_permissions("badge_rules")
    op.drop_table("badge_rules")
