"""backfill event owner_id from admin Users to matching Human

Events created from the backoffice historically stored ``owner_id =
current_user.id`` — an admin ``Users`` id, which lives in a separate table from
``Humans``. That left those events with no resolvable creator ("Unknown" in the
UI) and, because the portal gates editing on ``event.owner_id ==
current_human.id``, uneditable by anyone in the portal.

The create path is fixed going forward (owner now maps to the Human sharing the
admin's email). This migration repairs existing rows the same way: for every
event whose ``owner_id`` points at a ``Users`` row, re-point it to the ``Humans``
row with the same email in the same tenant. ``(email, tenant_id)`` is unique on
``humans`` so the target is unambiguous.

Only events whose owner is currently a Users id are touched. Events already
owned by a Human are left alone, and events whose owner matches neither table
(legacy/test rows with a dangling owner) are intentionally skipped — there is no
Human to map them to. No Humans are created; no other column changes.

Idempotent: once an event's owner is a Human, it no longer matches a Users row,
so re-running is a no-op.

Revision ID: c4e1a2f7b9d0
Revises: f4a9c1e7b6d2
Create Date: 2026-06-01
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "c4e1a2f7b9d0"
down_revision = "f4a9c1e7b6d2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            UPDATE events e
            SET owner_id = h.id
            FROM users u, humans h
            WHERE e.owner_id = u.id
              AND h.email = u.email
              AND h.tenant_id = e.tenant_id
              AND NOT EXISTS (
                  SELECT 1 FROM humans hx WHERE hx.id = e.owner_id
              )
            """
        )
    )
    print(f"backfill_event_owner_to_human: remapped {result.rowcount} event(s)")


def downgrade() -> None:
    # Data backfill — the prior admin Users owner_id is not retained, so there is
    # nothing to restore. Intentionally a no-op.
    pass
