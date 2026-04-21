"""confirm_insurance_template_config: move insurance customization from
insurance_checkout step to confirm step's template_config.

  - DELETE all ticketingsteps rows where step_type = 'insurance_checkout'
  - UPDATE confirm steps: populate template_config.insurance defaults
    (only if the key is absent — idempotent, preserves custom overrides)

Revision ID: b4f2a9c1e803
Revises: e1351f07b39a
Create Date: 2026-04-18
"""

import json
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4f2a9c1e803"
down_revision: str = "e1351f07b39a"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_INSURANCE_DEFAULTS = {
    "card_title": "Insurance",
    "card_subtitle": "Change of plans coverage",
    "toggle_label": "Add insurance",
    "benefits": [
        "Full refund up to 14 days before the event",
        "50% refund up to 7 days before",
        "Free date change at no extra cost",
    ],
}

_INSURANCE_WRAPPER_JSON = json.dumps({"insurance": _INSURANCE_DEFAULTS})


def upgrade() -> None:
    # 1. Remove insurance_checkout step rows — they no longer exist as standalone steps.
    #    insurance on/off is controlled solely by popup.insurance_enabled.
    op.get_bind().exec_driver_sql(
        "DELETE FROM ticketingsteps WHERE step_type = 'insurance_checkout'"
    )

    # 2. Upsert template_config.insurance into all confirm steps.
    #    - If template_config is SQL NULL, JSON null, or any non-object → replace with defaults
    #    - If template_config is an object without 'insurance' → merge it in
    #    - If template_config is an object with 'insurance' → leave it alone (custom override)
    #
    # The `jsonb_typeof != 'object'` guard is what prevents `null || {obj}` from
    # producing a surprise array `[null, obj]` — seeded confirm rows sometimes end
    # up as JSON null instead of SQL NULL.
    op.get_bind().exec_driver_sql(
        """
        UPDATE ticketingsteps
        SET template_config = CASE
            WHEN template_config IS NULL
                OR jsonb_typeof(template_config) <> 'object'
            THEN %s::jsonb
            WHEN NOT (template_config ? 'insurance')
            THEN template_config || jsonb_build_object('insurance', (%s::jsonb) -> 'insurance')
            ELSE template_config
        END
        WHERE step_type = 'confirm'
        """,
        (_INSURANCE_WRAPPER_JSON, _INSURANCE_WRAPPER_JSON),
    )


def downgrade() -> None:
    # Remove the 'insurance' key from confirm steps' template_config.
    # insurance_checkout rows are NOT re-created (data loss acceptable in downgrade).
    op.get_bind().exec_driver_sql(
        """
        UPDATE ticketingsteps
        SET template_config = CASE
            WHEN template_config IS NULL THEN NULL
            WHEN template_config = jsonb_build_object('insurance', template_config -> 'insurance')
            THEN NULL
            ELSE template_config - 'insurance'
        END
        WHERE step_type = 'confirm'
          AND template_config ? 'insurance'
        """
    )
