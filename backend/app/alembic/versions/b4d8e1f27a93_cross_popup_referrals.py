"""let attendees share a popup of the same tenant they are not in

An attendee link used to be tied to the popup its owner had access to. Now an
attendee with access to one popup can share another popup of the same tenant,
if that popup's flow accepts it.

`invites.source_popup_id` records the popup whose access allowed the share.
The popup that receives the people decides whether it accepts these links
(`sales_flows.cross_popup_referrals_enabled`) and at what rate (its own
`max_referrals_per_attendee`).

Nothing is copied: no flow accepted links from other popups before this, so
NULL (off) is the honest starting point for every existing flow.

Revision ID: b4d8e1f27a93
Revises: f4b7c9d2e6a1
Create Date: 2026-09-16 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "b4d8e1f27a93"
down_revision = "f4b7c9d2e6a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_flows",
        sa.Column("cross_popup_referrals_enabled", sa.Boolean(), nullable=True),
    )

    op.add_column(
        "invites",
        sa.Column("source_popup_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_invites_source_popup_id_popups",
        "invites",
        "popups",
        ["source_popup_id"],
        ["id"],
    )
    op.create_index("ix_invites_source_popup_id", "invites", ["source_popup_id"])
    op.create_check_constraint(
        "ck_invites_source_popup_portal_only",
        "invites",
        "source_popup_id IS NULL OR referrer_human_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_invites_source_popup_portal_only", "invites", type_="check")
    op.drop_index("ix_invites_source_popup_id", table_name="invites")
    op.drop_constraint(
        "fk_invites_source_popup_id_popups", "invites", type_="foreignkey"
    )
    op.drop_column("invites", "source_popup_id")
    op.drop_column("sales_flows", "cross_popup_referrals_enabled")
