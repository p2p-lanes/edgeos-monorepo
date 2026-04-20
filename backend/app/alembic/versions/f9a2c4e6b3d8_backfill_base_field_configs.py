"""Defensive backfill: ensure every existing popup has a BaseFieldConfig for
every catalog base field it supports.

Post-migration, each popup ends up with the full catalog configured
(respecting its allows_spouse / allows_children / allows_scholarship flags).
Admins can then remove whatever they don't want. This closes the gap where
older popups were missing catalog fields added after their initial seed.

Revision ID: f9a2c4e6b3d8
Revises: d7e4b2a91c3f
Create Date: 2026-04-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f9a2c4e6b3d8"
down_revision: str = "d7e4b2a91c3f"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# Inline catalog snapshot. Kept here so the migration is stable across future
# catalog edits. Each tuple:
#   (field_name, section_key, position, required, label, placeholder, help_text, options)
BASE_FIELDS = [
    ("first_name", "profile", 0, True, "First name", None, None, None),
    ("last_name", "profile", 1, True, "Last name", None, None, None),
    (
        "telegram",
        "profile",
        2,
        True,
        "Telegram username",
        "username",
        (
            "The primary form of communication during {popup_name} "
            "will be a Telegram group, so create an account if you don't already have one"
        ),
        None,
    ),
    (
        "residence",
        "profile",
        3,
        True,
        "Usual location of residence",
        "City, State/Region, Country",
        "Please format it like [City, State/Region, Country].",
        None,
    ),
    (
        "gender",
        "profile",
        4,
        True,
        "Gender",
        None,
        None,
        ["Male", "Female", "Non-binary", "Specify"],
    ),
    (
        "age",
        "profile",
        5,
        True,
        "Age",
        None,
        None,
        ["18-24", "25-34", "35-44", "45-54", "55+"],
    ),
    (
        "referral",
        "profile",
        6,
        False,
        "Did anyone refer you?",
        None,
        "List everyone who encouraged you to apply.",
        None,
    ),
    (
        "info_not_shared",
        "info_not_shared",
        0,
        False,
        "Info I'm NOT willing to share with other attendees",
        None,
        "We will make a directory to make it easier for attendees to coordinate",
        ["Email", "Telegram", "Organization", "Role", "Gender", "Age", "Residence"],
    ),
    (
        "partner",
        "companions",
        0,
        False,
        "Name of spouse/partner + duration of their stay",
        "Name",
        (
            "We will approve your spouse/partner if we approve you. However please "
            "have them fill out this form as well so we have their information in our system."
        ),
        None,
    ),
    (
        "partner_email",
        "companions",
        1,
        False,
        "Spouse/partner email",
        "Email",
        "Please provide your spouse/partner's email so we can remind them to apply.",
        None,
    ),
    (
        "kids",
        "companions",
        2,
        False,
        "I'm bringing kids",
        None,
        (
            "We will approve your kids if we approve you. "
            "Your kids do not need to fill out their own version of this form however."
        ),
        None,
    ),
    (
        "scholarship_request",
        "scholarship",
        0,
        False,
        "I am requesting a scholarship",
        None,
        "Apply for financial support to attend this event",
        None,
    ),
    (
        "scholarship_video_url",
        "scholarship",
        1,
        False,
        "Scholarship video",
        "https://...",
        "You can upload your video to Dropbox, Google Drive, Youtube, or anywhere where you can make the link public and viewable.",
        None,
    ),
    (
        "scholarship_details",
        "scholarship",
        2,
        False,
        "Scholarship details",
        "Describe why you need financial support...",
        None,
        None,
    ),
]

SECTIONS = {
    "profile": ("Personal Information", 0, "standard"),
    "info_not_shared": ("Info not shared", 1, "standard"),
    "companions": ("Children and +1s", 2, "companions"),
    "scholarship": ("Scholarship", 3, "scholarship"),
}

SPOUSE_FIELDS = {"partner", "partner_email"}
CHILDREN_FIELDS = {"kids"}
SCHOLARSHIP_FIELDS = {
    "scholarship_request",
    "scholarship_details",
    "scholarship_video_url",
}


def upgrade() -> None:
    conn = op.get_bind()

    popups = conn.execute(
        sa.text(
            "SELECT id, tenant_id, allows_spouse, allows_children, allows_scholarship "
            "FROM popups"
        )
    ).fetchall()

    for popup_id, tenant_id, allows_spouse, allows_children, allows_scholarship in popups:
        # Resolve existing sections for this popup; create missing ones that
        # the popup's flags allow.
        section_ids: dict[str, str] = {}
        for section_key, (label, order, kind) in SECTIONS.items():
            if section_key == "companions" and not (allows_spouse or allows_children):
                continue
            if section_key == "scholarship" and not allows_scholarship:
                continue

            # Match by kind first (introduced in migration a5f3c8e2d1b9),
            # falling back to label for legacy safety.
            existing = conn.execute(
                sa.text(
                    "SELECT id FROM formsections "
                    "WHERE popup_id = :popup_id AND (kind = :kind OR label = :label) "
                    "LIMIT 1"
                ),
                {"popup_id": popup_id, "kind": kind, "label": label},
            ).fetchone()

            if existing:
                section_ids[section_key] = existing[0]
                # Ensure kind is set correctly for legacy rows matched by label.
                conn.execute(
                    sa.text(
                        "UPDATE formsections SET kind = :kind "
                        "WHERE id = :id AND kind != :kind"
                    ),
                    {"id": existing[0], "kind": kind},
                )
            else:
                result = conn.execute(
                    sa.text(
                        "INSERT INTO formsections "
                        '(id, tenant_id, popup_id, label, "order", protected, kind) '
                        "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :label, :order, true, :kind) "
                        "RETURNING id"
                    ),
                    {
                        "tenant_id": tenant_id,
                        "popup_id": popup_id,
                        "label": label,
                        "order": order,
                        "kind": kind,
                    },
                )
                section_ids[section_key] = result.fetchone()[0]

        for (
            field_name,
            section_key,
            position,
            required,
            label,
            placeholder,
            help_text,
            options,
        ) in BASE_FIELDS:
            if field_name in SPOUSE_FIELDS and not allows_spouse:
                continue
            if field_name in CHILDREN_FIELDS and not allows_children:
                continue
            if field_name in SCHOLARSHIP_FIELDS and not allows_scholarship:
                continue

            section_id = section_ids.get(section_key)
            if not section_id:
                # Section missing because the popup's flags disallowed it.
                continue

            conn.execute(
                sa.text(
                    "INSERT INTO basefieldconfigs "
                    "(id, tenant_id, popup_id, field_name, section_id, position, "
                    " required, label, placeholder, help_text, options) "
                    "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :field_name, "
                    " :section_id, :position, :required, :label, :placeholder, "
                    " :help_text, :options) "
                    "ON CONFLICT (popup_id, field_name) DO NOTHING"
                ),
                {
                    "tenant_id": tenant_id,
                    "popup_id": popup_id,
                    "field_name": field_name,
                    "section_id": section_id,
                    "position": position,
                    "required": required,
                    "label": label,
                    "placeholder": placeholder,
                    "help_text": help_text,
                    "options": options,
                },
            )


def downgrade() -> None:
    # No-op: this migration only creates missing rows, undoing it would
    # require tracking which rows were ours vs pre-existing. Since the
    # effect is additive and idempotent, downgrade is deliberately empty.
    pass
