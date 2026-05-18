"""Backfill the buyer step into every direct-sale popup that doesn't already have one.

Open-ticketing checkouts previously rendered the buyer-info step ("Your
information") as a synthetic React-only step. We now require a real
``ticketingsteps`` row so admins can edit its title, description, emoji
and ordering from the backoffice like any other step.

For every popup where ``sale_type='direct'`` and no row with
``step_type='buyer'`` exists, this migration inserts one with:

* ``step_type='buyer'``, ``template='buyer-form'``
* Order placed immediately before the existing ``confirm`` step (shifting
  ``confirm`` and anything past it up by one). When no confirm step
  exists the buyer row is appended at the end.
* ``protected=True`` so the row can't be deleted by accident from the UI.

The row ID is derived from a deterministic UUIDv5 over the popup id
(plus this migration's revision id as the namespace seed). That way the
downgrade can target exactly the rows this migration created — admins
who later recreate the buyer step from the UI will get a different UUID,
and their work won't be wiped if someone rolls this migration back.

Revision ID: c8d3a5e1f29b
Revises: a3f72c1d9b0e
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c8d3a5e1f29b"
down_revision: str | Sequence[str] | None = "a3f72c1d9b0e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# UUIDv5 namespace seeded from this revision. Deterministic so the same
# popup id always yields the same row id — required for the targeted
# downgrade to find the row it inserted.
_NAMESPACE = uuid.UUID("c8d3a5e1-f29b-5000-8000-000000000000")


def _buyer_row_id(popup_id: uuid.UUID) -> uuid.UUID:
    return uuid.uuid5(_NAMESPACE, str(popup_id))


def upgrade() -> None:
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            """
            SELECT p.id AS popup_id, p.tenant_id
            FROM popups p
            WHERE p.sale_type = 'direct'
              AND NOT EXISTS (
                SELECT 1
                FROM ticketingsteps s
                WHERE s.popup_id = p.id
                  AND s.step_type = 'buyer'
              )
            """
        )
    ).all()

    for row in rows:
        confirm_order = conn.execute(
            sa.text(
                """
                SELECT "order" FROM ticketingsteps
                WHERE popup_id = :pid AND step_type = 'confirm'
                LIMIT 1
                """
            ),
            {"pid": row.popup_id},
        ).scalar()

        if confirm_order is not None:
            conn.execute(
                sa.text(
                    """
                    UPDATE ticketingsteps
                    SET "order" = "order" + 1
                    WHERE popup_id = :pid AND "order" >= :ord
                    """
                ),
                {"pid": row.popup_id, "ord": confirm_order},
            )
            buyer_order = confirm_order
        else:
            buyer_order = conn.execute(
                sa.text(
                    """
                    SELECT COALESCE(MAX("order"), -1) + 1
                    FROM ticketingsteps
                    WHERE popup_id = :pid
                    """
                ),
                {"pid": row.popup_id},
            ).scalar()

        conn.execute(
            sa.text(
                """
                INSERT INTO ticketingsteps (
                    id, tenant_id, popup_id, step_type, title,
                    description, "order", is_enabled, protected,
                    template, template_config, watermark,
                    show_title, show_watermark, show_in_navbar
                ) VALUES (
                    :id, :tid, :pid, 'buyer', :title,
                    :description, :ord, true, true,
                    'buyer-form', NULL, :watermark,
                    false, true, true
                )
                """
            ),
            {
                "id": _buyer_row_id(row.popup_id),
                "tid": row.tenant_id,
                "pid": row.popup_id,
                "ord": buyer_order,
                "title": "Your information",
                "description": "Complete your information before payment.",
                "watermark": "Your info",
            },
        )


def downgrade() -> None:
    # Targeted revert: only remove the rows this migration inserted, by
    # rebuilding the deterministic UUIDv5 ids per direct-sale popup.
    # Admin-customized buyer steps (different id) are left untouched.
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            """
            SELECT id FROM popups WHERE sale_type = 'direct'
            """
        )
    ).all()

    for row in rows:
        conn.execute(
            sa.text(
                """
                DELETE FROM ticketingsteps WHERE id = :rid
                """
            ),
            {"rid": _buyer_row_id(row.id)},
        )
