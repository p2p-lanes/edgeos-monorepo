"""give the gathering back the email templates that are not about a sale

Design: sdd/sales-flows-rediseno — repairs `b8e4c1d90a2f`.

That backfill claimed every `email_templates` row with a popup for the
popup's default flow, on the reading that a template is configuration and
configuration belongs to a flow. It is only half true. A flow owns the
mails its sale produces — the application lifecycle, the payment receipt,
the reminders. It has no claim on the mails a gathering sends to everyone
who is going, whatever they bought: the event invitation, the schedule
change, the check-in pass.

Those senders have no sales flow to pass, so once the popup tier was
deleted their customization stopped resolving anything. An operator's
edited event invitation went out as the template shipped with the product,
with no error and no log line.

This moves the rows of the types that are not about a sale back to the
popup tier, which is once again the tier that owns them. Rows of the eleven
sale types stay on their flow — those are correct where they are.

Two flows of one popup could each hold a copy of the same type, and both
would land on the same popup tier. The backfill only ever wrote to the
default flow, so this needs a second flow's copy to have been made by hand.
It aborts rather than choosing which copy survives.

Downgrade is deliberately a no-op: a row on the popup tier is
indistinguishable from one an operator put there on purpose afterwards.

Revision ID: e8b3f5a17d26
Revises: f2a8c604b9e1
Create Date: 2026-08-07 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e8b3f5a17d26"
down_revision = "f2a8c604b9e1"
branch_labels = None
depends_on = None

# Mirrors everything app.services.email.templates.get_template_scope calls
# POPUP. Duplicated rather than imported: a migration must not depend on
# application code that can change shape after it ships.
POPUP_SCOPED_TYPES: tuple[str, ...] = (
    "login_code_user",
    "event_invitation",
    "event_updated",
    "event_cancelled",
    "event_rsvp_cancelled",
    "event_approval_approved",
    "event_approval_rejected",
    "check_in_pass",
)


def upgrade() -> None:
    conn = op.get_bind()
    types = list(POPUP_SCOPED_TYPES)

    collisions = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM ("
            "  SELECT popup_id, template_type FROM email_templates "
            "  WHERE template_type = ANY(:types) AND popup_id IS NOT NULL "
            "  GROUP BY popup_id, template_type HAVING COUNT(*) > 1"
            ") AS dupes"
        ),
        {"types": types},
    ).scalar()
    if collisions:
        raise RuntimeError(
            "return_gathering_emails_to_the_popup_tier: "
            f"{collisions} (popup, template_type) pair(s) hold more than one "
            "row — resolve the duplicates first"
        )

    result = conn.execute(
        sa.text(
            "UPDATE email_templates SET sales_flow_id = NULL "
            "WHERE sales_flow_id IS NOT NULL AND template_type = ANY(:types)"
        ),
        {"types": types},
    )
    print(f"returned {result.rowcount} template(s) to the popup tier")


def downgrade() -> None:
    # Deliberate no-op — see module docstring.
    pass
