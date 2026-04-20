"""insurance_checkout_step_protect: backfill existing insurance_checkout steps with
protected=true, template='insurance-card', and default template_config.
Also inserts missing insurance_checkout rows for popups that have none.

Revision ID: e1351f07b39a
Revises: 9d4da1d6ca25
Create Date: 2026-04-18
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1351f07b39a"
down_revision: str = "9d4da1d6ca25"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_TEMPLATE_CONFIG_JSON = (
    '{"card_title":"Insurance","card_subtitle":"Change of plans coverage",'
    '"toggle_label":"Add insurance","benefits":["Full refund up to 14 days before the event",'
    '"50% refund up to 7 days before","Free date change at no extra cost"]}'
)


def upgrade() -> None:
    # 1. Update existing insurance_checkout rows:
    #    - Always set protected = true
    #    - Set template only if currently NULL (don't overwrite custom templates)
    #    - Set template_config only if currently NULL (don't overwrite custom configs)
    op.execute(
        f"""
        UPDATE ticketingsteps
        SET
            protected = true,
            template = CASE WHEN template IS NULL THEN 'insurance-card' ELSE template END,
            template_config = CASE
                WHEN template_config IS NULL THEN
                    '{_TEMPLATE_CONFIG_JSON}'::jsonb
                ELSE template_config
            END
        WHERE step_type = 'insurance_checkout'
        """
    )

    # 2. Insert missing insurance_checkout rows for popups that don't have one yet.
    #    Safety net: catches popups created before this feature landed.
    op.execute(
        f"""
        INSERT INTO ticketingsteps (
            id, popup_id, tenant_id, step_type, title, description,
            "order", is_enabled, protected, template, template_config
        )
        SELECT
            gen_random_uuid(),
            p.id,
            p.tenant_id,
            'insurance_checkout',
            'Insurance',
            'Optional: Protect your purchase',
            4,
            false,
            true,
            'insurance-card',
            '{_TEMPLATE_CONFIG_JSON}'::jsonb
        FROM popups p
        WHERE NOT EXISTS (
            SELECT 1 FROM ticketingsteps ts
            WHERE ts.popup_id = p.id
              AND ts.step_type = 'insurance_checkout'
        )
        """
    )


def downgrade() -> None:
    # Reverse: set protected back to false, clear template and template_config for
    # insurance_checkout rows that have the default template (don't touch custom ones).
    op.execute(
        """
        UPDATE ticketingsteps
        SET
            protected = false,
            template = NULL,
            template_config = NULL
        WHERE step_type = 'insurance_checkout'
          AND template = 'insurance-card'
        """
    )
    # Note: rows inserted by this migration cannot be safely removed in downgrade
    # because we can't distinguish them from manually-created rows.
