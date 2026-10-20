"""Move legacy application sharing choices to human directory settings.

Revision ID: 6f702315ea94
Revises: dcb07d3de9ee
Create Date: 2026-10-20 12:47:01.869637

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "6f702315ea94"
down_revision = "dcb07d3de9ee"
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
    # Translate every currently-configured directory field to the new stable
    # field id. A privacy choice from any application in this popup remains
    # private for that Human; the popup directory no longer reads application
    # form answers at request time.
    op.execute(
        f"""
        WITH legacy_people AS (
            SELECT DISTINCT
                applications.tenant_id,
                applications.human_id,
                applications.popup_id,
                popups.directory_fields
            FROM applications
            JOIN popups ON popups.id = applications.popup_id
            WHERE applications.human_id IS NOT NULL
        ), configured AS (
            SELECT
                legacy_people.tenant_id,
                legacy_people.human_id,
                legacy_people.popup_id,
                CASE
                    WHEN jsonb_typeof(legacy_people.directory_fields) = 'array'
                         AND jsonb_array_length(legacy_people.directory_fields) > 0
                    THEN legacy_people.directory_fields
                    ELSE '{_DEFAULT_DIRECTORY_FIELDS}'::jsonb
                END AS fields
            FROM legacy_people
        ), migrated AS (
            SELECT
                configured.tenant_id,
                configured.human_id,
                configured.popup_id,
                COALESCE((
                    SELECT array_agg(
                        configured_field.field->>'id'
                        ORDER BY configured_field.field_position
                    )
                    FROM jsonb_array_elements(configured.fields)
                        WITH ORDINALITY AS configured_field(field, field_position)
                    WHERE configured_field.field->>'id' IS NOT NULL
                      AND configured_field.field->>'shareable' IS DISTINCT FROM 'false'
                      AND NOT EXISTS (
                          SELECT 1
                          FROM applications
                          CROSS JOIN LATERAL unnest(applications.info_not_shared)
                              AS legacy_choice(value)
                          WHERE applications.human_id = configured.human_id
                            AND applications.popup_id = configured.popup_id
                            AND regexp_replace(
                                lower(btrim(legacy_choice.value)),
                                '[^a-z0-9]+', '', 'g'
                            ) = ANY(ARRAY[
                                regexp_replace(lower(COALESCE(configured_field.field->>'id', '')), '[^a-z0-9]+', '', 'g'),
                                regexp_replace(lower(COALESCE(configured_field.field->>'key', '')), '[^a-z0-9]+', '', 'g'),
                                regexp_replace(lower(COALESCE(configured_field.field->>'label', '')), '[^a-z0-9]+', '', 'g'),
                                CASE regexp_replace(lower(COALESCE(configured_field.field->>'key', '')), '[^a-z0-9]+', '', 'g')
                                    WHEN 'roleintheorganization' THEN 'role'
                                    WHEN 'organizationyourepresent' THEN 'organization'
                                    ELSE regexp_replace(lower(COALESCE(configured_field.field->>'key', '')), '[^a-z0-9]+', '', 'g')
                                END
                            ])
                      )
                ), ARRAY[]::text[]) AS shared_fields
            FROM configured
        )
        INSERT INTO human_directory_settings (
            id, tenant_id, human_id, popup_id, listed, shared_fields
        )
        SELECT gen_random_uuid(), tenant_id, human_id, popup_id, true, shared_fields
        FROM migrated
        ON CONFLICT (human_id, popup_id) DO UPDATE
        SET shared_fields = EXCLUDED.shared_fields
        """
    )

    # Remove the retired field from existing application forms. The migration
    # above has already transferred its answers to popup-scoped settings.
    op.execute("DELETE FROM basefieldconfigs WHERE field_name = 'info_not_shared'")
    op.execute(
        """
        DELETE FROM formsections AS section
        WHERE lower(btrim(section.label)) = 'info not shared'
          AND section.protected IS FALSE
          AND NOT EXISTS (
              SELECT 1 FROM formfields WHERE formfields.section_id = section.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM basefieldconfigs
              WHERE basefieldconfigs.section_id = section.id
          )
        """
    )


def downgrade() -> None:
    # Legacy answers stay on the application throughout the upgrade. No
    # reconstruction is necessary, and current directory choices must not
    # overwrite the original answers when downgrading.
    op.execute(
        """
        WITH legacy_sections AS (
            INSERT INTO formsections (
                id, tenant_id, popup_id, sales_flow_id, label, "order",
                protected, hidden, kind
            )
            SELECT
                gen_random_uuid(), flow.tenant_id, flow.popup_id, flow.id,
                'Info not shared', 1, false, false, 'standard'
            FROM sales_flows AS flow
            WHERE flow.type = 'application'
              AND NOT EXISTS (
                  SELECT 1 FROM formsections AS existing
                  WHERE existing.sales_flow_id = flow.id
                    AND lower(btrim(existing.label)) = 'info not shared'
              )
            RETURNING id, tenant_id, popup_id, sales_flow_id
        ), all_sections AS (
            SELECT id, tenant_id, popup_id, sales_flow_id FROM legacy_sections
            UNION ALL
            SELECT id, tenant_id, popup_id, sales_flow_id
            FROM formsections
            WHERE lower(btrim(label)) = 'info not shared'
        )
        INSERT INTO basefieldconfigs (
            id, tenant_id, popup_id, sales_flow_id, field_name, section_id,
            position, required, label, placeholder, help_text, options
        )
        SELECT
            gen_random_uuid(), section.tenant_id, section.popup_id,
            section.sales_flow_id, 'info_not_shared', section.id, 0, false,
            'Info I am not willing to share with other attendees', NULL,
            'We will make a directory to make it easier for attendees to coordinate',
            ARRAY['Email', 'Telegram', 'Organization', 'Role', 'Gender', 'Age', 'Residence']
        FROM all_sections AS section
        WHERE NOT EXISTS (
            SELECT 1 FROM basefieldconfigs AS existing
            WHERE existing.sales_flow_id = section.sales_flow_id
              AND existing.field_name = 'info_not_shared'
        )
        """
    )
