"""Restore unambiguous companion categories from approved purchase snapshots."""

from alembic import op

revision = "d6f2b8a94c31"
down_revision = "c6f1a8e4d2b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH companion_categories AS (
            SELECT a.id AS attendee_id,
                   (array_agg(DISTINCT r.category_id))[1] AS category_id
            FROM attendees a
            JOIN payment_recipients r
              ON r.attendee_id = a.id AND r.tenant_id = a.tenant_id
            JOIN payments p
              ON p.id = r.payment_id AND p.tenant_id = a.tenant_id
             AND p.popup_id = a.popup_id
             AND p.buyer_human_id = a.managed_by_human_id
            JOIN attendee_categories c
              ON c.id = r.category_id AND c.tenant_id = a.tenant_id
             AND c.popup_id = a.popup_id
             AND c.sales_flow_id = p.sales_flow_id
            WHERE a.category_id IS NULL
              AND a.human_id IS NULL
              AND a.application_id IS NULL
              AND a.managed_by_human_id IS NOT NULL
              AND p.status = 'approved'
              AND c.deleted_at IS NULL
            GROUP BY a.id
            HAVING count(DISTINCT r.category_id) = 1
               AND bool_and(NOT c.is_primary AND r.human_id IS NULL)
        )
        UPDATE attendees a SET category_id = c.category_id
        FROM companion_categories c
        WHERE a.id = c.attendee_id
        """
    )


def downgrade() -> None:
    # Data repair only. Clearing categories would also erase legitimate values
    # assigned after the upgrade; keep the recovered historical information.
    pass
