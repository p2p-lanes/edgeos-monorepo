"""Backfill buyer step into every direct-sale popup that doesn't already have one.

Open-ticketing checkouts previously rendered the buyer-info step ("Tu
información") as a synthetic React-only step. We now require a real
``ticketing_steps`` row so admins can edit its title, emoji, and ordering.

For every popup where ``sale_type='direct'`` and no ``buyer`` step row
exists, this migration inserts one with:

* ``step_type='buyer'``, ``template='buyer-form'``
* Order = ``max(order) + 1`` shifted just before the ``confirm`` step
* ``protected=True`` so the row can't be deleted accidentally

If the popup already has a buyer step (e.g. created post-migration), we
leave it untouched.

Revision ID: e2c8b146a7d3
Revises: d1e3f7a90c12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2c8b146a7d3"
down_revision: str | Sequence[str] | None = "d1e3f7a90c12"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    # Locate direct-sale popups with no buyer step row yet.
    rows = conn.execute(
        sa.text(
            """
            SELECT p.id AS popup_id, p.tenant_id, p.name
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
        # Place the buyer step immediately before confirm (so the buyer fills
        # in their info, then reviews + pays). If the popup has no confirm
        # step yet we append at the end.
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
            # Shift the confirm step (and anything past it) up one slot.
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
                    SELECT COALESCE(MAX("order"), -1) + 1 FROM ticketingsteps
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
                    show_title, show_watermark
                ) VALUES (
                    gen_random_uuid(), :tid, :pid, 'buyer', :title,
                    :description, :ord, true, true,
                    'buyer-form', NULL, :watermark,
                    false, true
                )
                """
            ),
            {
                "tid": row.tenant_id,
                "pid": row.popup_id,
                "ord": buyer_order,
                "title": "Your information",
                "description": "Complete your information before payment.",
                "watermark": "Your info",
            },
        )


def downgrade() -> None:
    # Best-effort: remove buyer steps inserted by this migration. Steps the
    # tenant later customised will still get removed — admins can recreate
    # them through the backoffice if needed.
    op.execute(
        """
        DELETE FROM ticketingsteps
        WHERE step_type = 'buyer' AND template = 'buyer-form'
        """
    )
