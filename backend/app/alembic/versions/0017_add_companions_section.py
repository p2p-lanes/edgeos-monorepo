"""Add companions section and base field configs for existing popups.

The companions section (partner, partner_email, kids) was added to
DEFAULT_SECTIONS and BASE_FIELD_DEFINITIONS after migration 0013 seeded
the initial sections. This migration creates the section and field configs
for all popups that don't have them yet.

Revision ID: 0017_add_companions
Revises: 0016_remove_org_role
Create Date: 2026-03-05

"""

import sqlalchemy as sa
from alembic import op

revision = "0017_add_companions"
down_revision = "0016_remove_org_role"
branch_labels = None
depends_on = None

COMPANIONS_LABEL = "Children and +1s"
COMPANIONS_ORDER = 2

# (field_name, position, placeholder, help_text)
COMPANION_FIELDS = [
    (
        "partner",
        0,
        "Name",
        "We will approve your spouse/partner if we approve you. "
        "However please have them fill out this form as well so we have their information in our system.",
    ),
    (
        "partner_email",
        1,
        "Email",
        "Please provide your spouse/partner's email so we can remind them to apply.",
    ),
    (
        "kids",
        2,
        None,
        "We will approve your kids if we approve you. "
        "Your kids do not need to fill out their own version of this form however.",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()

    # Get all popups that don't already have a companions section
    popups = conn.execute(
        sa.text(
            "SELECT p.id, p.tenant_id FROM popups p "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM formsections fs "
            "  WHERE fs.popup_id = p.id AND fs.label = :label"
            ")"
        ),
        {"label": COMPANIONS_LABEL},
    ).fetchall()

    for popup_id, tenant_id in popups:
        # Create companions section
        result = conn.execute(
            sa.text(
                "INSERT INTO formsections "
                '(id, tenant_id, popup_id, label, "order", protected) '
                "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :label, :order, true) "
                "RETURNING id"
            ),
            {
                "tenant_id": tenant_id,
                "popup_id": popup_id,
                "label": COMPANIONS_LABEL,
                "order": COMPANIONS_ORDER,
            },
        )
        section_id = result.fetchone()[0]

        # Create base field configs for companion fields
        for field_name, position, placeholder, help_text in COMPANION_FIELDS:
            conn.execute(
                sa.text(
                    "INSERT INTO basefieldconfigs "
                    "(id, tenant_id, popup_id, field_name, section_id, position, placeholder, help_text) "
                    "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :field_name, :section_id, :position, :placeholder, :help_text) "
                    "ON CONFLICT (popup_id, field_name) DO NOTHING"
                ),
                {
                    "tenant_id": tenant_id,
                    "popup_id": popup_id,
                    "field_name": field_name,
                    "section_id": section_id,
                    "position": position,
                    "placeholder": placeholder,
                    "help_text": help_text,
                },
            )


def downgrade() -> None:
    conn = op.get_bind()

    # Delete base field configs for companion fields
    conn.execute(
        sa.text(
            "DELETE FROM basefieldconfigs "
            "WHERE field_name = ANY(:field_names)"
        ),
        {"field_names": [f[0] for f in COMPANION_FIELDS]},
    )

    # Delete companions sections
    conn.execute(
        sa.text(
            "DELETE FROM formsections WHERE label = :label"
        ),
        {"label": COMPANIONS_LABEL},
    )
