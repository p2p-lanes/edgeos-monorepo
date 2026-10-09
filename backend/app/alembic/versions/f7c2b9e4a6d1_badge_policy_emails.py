"""Badge issuer policies: an emails audience.

A policy's audience can now be a list of email addresses, matched against
the giver's email, so it covers people who haven't signed up yet. The list
lives on the policy (``emails``, lowercased) rather than in a link table:
it's read whole when resolving who may give, never queried by address.

Downgrade deletes emails-audience policies, which the old format can't
express (awards they gave keep their ``policy_id`` set to NULL).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "f7c2b9e4a6d1"
down_revision = "e5a1c3d7f9b2"
branch_labels = None
depends_on = None

AUDIENCES = "audience_type IN ('humans', 'popup_attendees', 'tenant'{extra})"


def upgrade():
    op.add_column(
        "badge_issuer_policies",
        sa.Column("emails", JSONB(), nullable=False, server_default="[]"),
    )
    op.drop_constraint(
        "ck_badge_issuer_policies_audience", "badge_issuer_policies", type_="check"
    )
    op.create_check_constraint(
        "ck_badge_issuer_policies_audience",
        "badge_issuer_policies",
        AUDIENCES.format(extra=", 'emails'"),
    )


def downgrade():
    op.execute("DELETE FROM badge_issuer_policies WHERE audience_type = 'emails'")
    op.drop_constraint(
        "ck_badge_issuer_policies_audience", "badge_issuer_policies", type_="check"
    )
    op.create_check_constraint(
        "ck_badge_issuer_policies_audience",
        "badge_issuer_policies",
        AUDIENCES.format(extra=""),
    )
    op.drop_column("badge_issuer_policies", "emails")
