"""Add base_field_configs table for per-popup base field presentation config

Revision ID: 0013_add_base_field_configs
Revises: 0012_add_form_sections
Create Date: 2026-03-04

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "0013_add_base_field_configs"
down_revision = "0012_add_form_sections"
branch_labels = None
depends_on = None

# Must match BASE_FIELD_DEFINITIONS keys and their defaults
# (field_name, section_key, position, placeholder, help_text, options)
BASE_FIELDS = [
    ("first_name", "profile", 0, None, None, None),
    ("last_name", "profile", 1, None, None, None),
    (
        "telegram",
        "profile",
        2,
        "username",
        "The primary form of communication during {popup_name} "
        "will be a Telegram group, so create an account if you don't already have one",
        None,
    ),
    (
        "residence",
        "profile",
        3,
        "City, State/Region, Country",
        "Please format it like [City, State/Region, Country].",
        None,
    ),
    ("gender", "profile", 4, None, None, ["Male", "Female", "Non-binary", "Specify"]),
    ("age", "profile", 5, None, None, ["18-24", "25-34", "35-44", "45-54", "55+"]),
    ("organization", "profile", 6, None, None, None),
    ("role", "profile", 7, None, None, None),
    (
        "referral",
        "profile",
        8,
        None,
        "List everyone who encouraged you to apply.",
        None,
    ),
    (
        "info_not_shared",
        "info_not_shared",
        0,
        None,
        "We will make a directory to make it easier for attendees to coordinate",
        ["Email", "Telegram", "Organization", "Role", "Gender", "Age", "Residence"],
    ),
]

DEFAULT_SECTIONS = {
    "profile": ("Profile", 0),
    "info_not_shared": ("Info not shared", 1),
}


def upgrade():
    # 0. Add protected column to formsections
    op.add_column(
        "formsections",
        sa.Column("protected", sa.Boolean(), nullable=False, server_default="false"),
    )

    # 1. Create basefieldconfigs table
    op.create_table(
        "basefieldconfigs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "popup_id",
            UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("field_name", sa.String(100), nullable=False, index=True),
        sa.Column(
            "section_id",
            UUID(as_uuid=True),
            sa.ForeignKey("formsections.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("placeholder", sa.Text(), nullable=True),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("options", ARRAY(sa.String), nullable=True),
        sa.UniqueConstraint(
            "popup_id", "field_name", name="uq_base_field_config_popup_field"
        ),
    )

    # 2. Apply RLS
    add_tenant_table_permissions("basefieldconfigs")

    # 3. Seed data for existing popups
    # For each popup, create "Profile" and "Info not shared" sections
    # (only if they don't already exist for that popup)
    conn = op.get_bind()

    popups = conn.execute(sa.text("SELECT id, tenant_id FROM popups")).fetchall()

    for popup_id, tenant_id in popups:
        # Create default sections (idempotent: skip if label already exists for popup)
        section_ids = {}
        for section_key, (label, order) in DEFAULT_SECTIONS.items():
            existing = conn.execute(
                sa.text(
                    "SELECT id FROM formsections WHERE popup_id = :popup_id AND label = :label"
                ),
                {"popup_id": popup_id, "label": label},
            ).fetchone()

            if existing:
                section_ids[section_key] = existing[0]
                # Mark existing section as protected
                conn.execute(
                    sa.text(
                        "UPDATE formsections SET protected = true WHERE id = :id"
                    ),
                    {"id": existing[0]},
                )
            else:
                result = conn.execute(
                    sa.text(
                        """
                        INSERT INTO formsections (id, tenant_id, popup_id, label, "order", protected)
                        VALUES (gen_random_uuid(), :tenant_id, :popup_id, :label, :order, true)
                        RETURNING id
                        """
                    ),
                    {
                        "tenant_id": tenant_id,
                        "popup_id": popup_id,
                        "label": label,
                        "order": order,
                    },
                )
                section_ids[section_key] = result.fetchone()[0]

        # Create base field configs for each field
        for field_name, section_key, position, placeholder, help_text, options in BASE_FIELDS:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO basefieldconfigs
                        (id, tenant_id, popup_id, field_name, section_id, position, placeholder, help_text, options)
                    VALUES
                        (gen_random_uuid(), :tenant_id, :popup_id, :field_name, :section_id, :position, :placeholder, :help_text, :options)
                    ON CONFLICT (popup_id, field_name) DO NOTHING
                    """
                ),
                {
                    "tenant_id": tenant_id,
                    "popup_id": popup_id,
                    "field_name": field_name,
                    "section_id": section_ids.get(section_key),
                    "position": position,
                    "placeholder": placeholder,
                    "help_text": help_text,
                    "options": options,
                },
            )


def downgrade():
    remove_tenant_table_permissions("basefieldconfigs")
    op.drop_table("basefieldconfigs")
    op.drop_column("formsections", "protected")
