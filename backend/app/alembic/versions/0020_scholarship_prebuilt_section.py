"""Add scholarship prebuilt section and base field configs for existing popups.

The scholarship section (scholarship_request, scholarship_details,
scholarship_video_url) was added to DEFAULT_SECTIONS and BASE_FIELD_DEFINITIONS
after migration 0019 added the raw columns. This migration creates the section
and field configs for all existing popups that have allows_scholarship=True
and don't already have a scholarship section.

Revision ID: 0020_scholarship_section
Revises: 0019_scholarship
Create Date: 2026-03-11

"""

import sqlalchemy as sa
from alembic import op

revision = "0020_scholarship_section"
down_revision = "0019_scholarship"
branch_labels = None
depends_on = None

SCHOLARSHIP_LABEL = "Scholarship"
SCHOLARSHIP_ORDER = 3

# (field_name, position, placeholder, help_text)
SCHOLARSHIP_FIELDS = [
    (
        "scholarship_request",
        0,
        None,
        "Apply for financial support to attend this event",
    ),
    (
        "scholarship_details",
        1,
        "Describe why you need financial support...",
        None,
    ),
    (
        "scholarship_video_url",
        2,
        "https://...",
        "Optional: share a short video explaining your situation",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()

    # Get all popups with allows_scholarship=True that don't already have a scholarship section
    popups = conn.execute(
        sa.text(
            "SELECT p.id, p.tenant_id FROM popups p "
            "WHERE p.allows_scholarship = true "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM formsections fs "
            "  WHERE fs.popup_id = p.id AND fs.label = :label"
            ")"
        ),
        {"label": SCHOLARSHIP_LABEL},
    ).fetchall()

    for popup_id, tenant_id in popups:
        # Create scholarship section
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
                "label": SCHOLARSHIP_LABEL,
                "order": SCHOLARSHIP_ORDER,
            },
        )
        section_id = result.fetchone()[0]

        # Create base field configs for scholarship fields
        for field_name, position, placeholder, help_text in SCHOLARSHIP_FIELDS:
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

    # Delete base field configs for scholarship fields
    conn.execute(
        sa.text(
            "DELETE FROM basefieldconfigs "
            "WHERE field_name = ANY(:field_names)"
        ),
        {"field_names": [f[0] for f in SCHOLARSHIP_FIELDS]},
    )

    # Delete scholarship sections
    conn.execute(
        sa.text(
            "DELETE FROM formsections WHERE label = :label"
        ),
        {"label": SCHOLARSHIP_LABEL},
    )
