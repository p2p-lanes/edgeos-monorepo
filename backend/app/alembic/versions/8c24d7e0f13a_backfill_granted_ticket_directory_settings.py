"""Restore directory sharing for legacy ticket holders without settings.

Revision ID: 8c24d7e0f13a
Revises: 50c71da1e604
"""

from alembic import op

revision = "8c24d7e0f13a"
down_revision = "50c71da1e604"
branch_labels = None
depends_on = None


_DEFAULT_DIRECTORY_FIELDS = """
[
  {"id":"first_name","label":"First name","source":"human","key":"first_name"},
  {"id":"last_name","label":"Last name","source":"human","key":"last_name"},
  {"id":"email","label":"Email","source":"human","key":"email"},
  {"id":"telegram","label":"Telegram","source":"human","key":"telegram"}
]
"""


def upgrade() -> None:
    # The original backfills only reached people with applications. Ticket
    # grants and companions may have no application of their own, but were
    # already visible in the old directory. Never overwrite an opt-out.
    op.execute(
        f"""
        WITH candidates AS (
            SELECT DISTINCT
                attendee.tenant_id, attendee.human_id, attendee.popup_id,
                popup.directory_fields
            FROM attendees AS attendee
            JOIN attendee_categories AS category
                ON category.id = attendee.category_id
            JOIN popups AS popup ON popup.id = attendee.popup_id
            WHERE attendee.human_id IS NOT NULL
              AND category.directory_eligible IS TRUE
              AND EXISTS (
                  SELECT 1 FROM attendee_products AS ticket
                  WHERE ticket.attendee_id = attendee.id
                    AND ticket.product_category_snapshot = 'ticket'
                    AND ticket.revoked_at IS NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM human_directory_settings AS settings
                  WHERE settings.human_id = attendee.human_id
                    AND settings.popup_id = attendee.popup_id
              )
        )
        INSERT INTO human_directory_settings (
            id, tenant_id, human_id, popup_id, listed, shared_fields
        )
        SELECT gen_random_uuid(), tenant_id, human_id, popup_id, true,
               ARRAY(
                   SELECT field->>'id'
                   FROM jsonb_array_elements(
                       CASE
                           WHEN jsonb_typeof(directory_fields) = 'array'
                                AND jsonb_array_length(directory_fields) > 0
                           THEN directory_fields
                           ELSE '{_DEFAULT_DIRECTORY_FIELDS}'::jsonb
                       END
                   ) AS field
                   WHERE field->>'id' IS NOT NULL
                     AND field->>'shareable' IS DISTINCT FROM 'false'
               )
        FROM candidates
        ON CONFLICT (human_id, popup_id) DO NOTHING
        """
    )


def downgrade() -> None:
    # Later consent changes cannot be distinguished from the backfill.
    pass
