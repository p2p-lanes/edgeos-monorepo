"""Backfill attendee_products.payment_id from payment_products.

The ticket-as-first-class-entity refactor added the optional payment_id
column on attendee_products but the three internal call sites of
PaymentsCRUD._add_products_to_attendees did not forward the payment_id,
so every ticket created via the approval paths (approve_payment,
update_status -> APPROVED, and the auto-approve branch of create_payment)
ended up with payment_id=NULL.

This migration backfills the link wherever it can be done unambiguously:
for each NULL row, if exactly one APPROVED payment in payment_products
shares (attendee_id, product_id), set payment_id to that payment.

Ambiguous rows (the attendee has more than one approved payment for the
same product) are left untouched on purpose — those need product team
review because they signal a separate idempotency bug where one purchase
intent created two approved payments and two tickets.

Revision ID: 4dffd7a49bef
Revises: f6c1f50160ef
"""

from collections.abc import Sequence

from alembic import op

revision: str = "4dffd7a49bef"
down_revision: str | Sequence[str] | None = "f6c1f50160ef"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        WITH unique_pp AS (
            SELECT
                pp.attendee_id,
                pp.product_id,
                (array_agg(DISTINCT pp.payment_id))[1] AS payment_id
            FROM payment_products pp
            JOIN payments p ON p.id = pp.payment_id
            WHERE p.status = 'approved'
            GROUP BY pp.attendee_id, pp.product_id
            HAVING COUNT(DISTINCT pp.payment_id) = 1
        )
        UPDATE attendee_products ap
        SET payment_id = u.payment_id
        FROM unique_pp u
        WHERE ap.payment_id IS NULL
          AND ap.attendee_id = u.attendee_id
          AND ap.product_id  = u.product_id;
        """
    )


def downgrade() -> None:
    # No-op: re-NULLing rows would lose information and we can't tell which
    # rows this migration touched after the fact. Operators who need to
    # reverse the backfill should restore from snapshot.
    pass
