"""cleanup duplicate and orphan attendee_products from open-ticketing checkout

Revision ID: 94d7d49c3c92
Revises: 377c2c02fe74
Create Date: 2026-05-25

Root cause
----------
create_open_ticketing_payment pre-created AttendeeProducts rows while the
payment was still PENDING. When SimpleFI confirmed the payment, approve_payment
called _add_products_to_attendees (always-INSERT) creating a second set of rows
for the same tickets. Two classes of bad data resulted:

1. APPROVED payments (open-ticketing): 2x AttendeeProducts per ticket.
   Pre-created rows have a popup-slug prefix in their check_in_code
   (e.g. "SOL..."); approval-created rows have no prefix (shorter codes).
   Verified: 0 pre-created codes appear in check_ins — safe to delete.

2. EXPIRED payments (open-ticketing): ALL AttendeeProducts are orphans
   (payment never completed). All have the slug-prefix pattern since
   approve_payment was never called.

Fix: delete rows where check_in_code LIKE slug_prefix || '%', joined
to the popup via payments. This is precise — it targets only the pre-created
rows in both cases without relying on arbitrary UUID ordering.
"""

from alembic import op

revision = "94d7d49c3c92"
down_revision = "377c2c02fe74"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Dry-run: count rows that will be deleted
    to_delete = conn.execute(
        """
        SELECT COUNT(*)
        FROM attendee_products ap
        JOIN payments p ON p.id = ap.payment_id
        JOIN popups pu ON pu.id = p.popup_id
        WHERE p.application_id IS NULL
          AND p.status IN ('approved', 'expired')
          AND ap.check_in_code LIKE UPPER(LEFT(pu.slug, 3)) || '%'
        """
    ).scalar()

    print(f"\n[94d7d49c3c92] attendee_products cleanup — rows to delete: {to_delete}")

    # Delete pre-created AttendeeProducts rows:
    # - Approved payments: removes the slug-prefixed duplicates, keeps the
    #   approval-created rows (no prefix) which are the canonical tickets.
    # - Expired payments: removes all rows (all are slug-prefixed orphans).
    op.execute(
        """
        DELETE FROM attendee_products
        WHERE id IN (
            SELECT ap.id
            FROM attendee_products ap
            JOIN payments p ON p.id = ap.payment_id
            JOIN popups pu ON pu.id = p.popup_id
            WHERE p.application_id IS NULL
              AND p.status IN ('approved', 'expired')
              AND ap.check_in_code LIKE UPPER(LEFT(pu.slug, 3)) || '%'
        )
        """
    )


def downgrade() -> None:
    # Data-only migration — deleted rows cannot be recovered from schema alone.
    pass
