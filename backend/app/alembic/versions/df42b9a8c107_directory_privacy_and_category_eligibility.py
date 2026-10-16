"""Add popup-scoped directory privacy and category eligibility.

Revision ID: df42b9a8c107
Revises: e8a4f1c7d2b6
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "df42b9a8c107"
down_revision = "e8a4f1c7d2b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attendee_categories",
        sa.Column(
            "directory_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "directory_fields",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="[]",
        ),
    )
    op.execute(
        sa.text(
            """
            UPDATE popups AS popup
            SET directory_fields = '[
                {"id":"first_name","label":"First name","source":"human","key":"first_name"},
                {"id":"last_name","label":"Last name","source":"human","key":"last_name"},
                {"id":"email","label":"Email","source":"human","key":"email"},
                {"id":"telegram","label":"Telegram","source":"human","key":"telegram"}
            ]'::jsonb || COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'id', field.canonical_id,
                    'label', CASE field.canonical_id
                        WHEN 'role' THEN 'Role'
                        WHEN 'organization' THEN 'Organization'
                    END,
                    'source', 'application',
                    'key', field.name
                ) ORDER BY field.position)
                FROM (
                    SELECT DISTINCT ON (candidate.canonical_id)
                        candidate.name,
                        candidate.position,
                        candidate.canonical_id
                    FROM (
                        SELECT
                            form_field.name,
                            form_field.position,
                            CASE
                                WHEN form_field.name IN ('role', 'role_in_the_organization')
                                    THEN 'role'
                                WHEN form_field.name IN ('organization', 'organization_you_represent')
                                    THEN 'organization'
                            END AS canonical_id
                        FROM formfields AS form_field
                        JOIN sales_flows AS flow
                          ON flow.id = form_field.sales_flow_id
                        WHERE form_field.popup_id = popup.id
                          AND flow.is_default IS TRUE
                          AND flow.type = 'application'
                          AND form_field.name IN (
                              'role', 'role_in_the_organization',
                              'organization', 'organization_you_represent'
                          )
                    ) AS candidate
                    ORDER BY candidate.canonical_id,
                             (candidate.name = candidate.canonical_id) DESC,
                             candidate.position
                ) AS field
            ), '[]'::jsonb)
            WHERE popup.show_attendee_directory IS TRUE
            """
        )
    )
    # Preserve the legacy directory population during rollout. Future
    # eligibility is an explicit category setting, not inferred from its key.
    op.execute(
        "UPDATE attendee_categories SET directory_eligible = true "
        "WHERE is_primary = true OR lower(btrim(key)) = 'spouse'"
    )
    op.create_table(
        "human_directory_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("listed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "shared_fields",
            postgresql.ARRAY(sa.String()),
            server_default="{}",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["human_id"], ["humans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "human_id", "popup_id", name="uq_human_directory_settings_human_popup"
        ),
    )
    op.create_index(
        "ix_human_directory_settings_tenant_id",
        "human_directory_settings",
        ["tenant_id"],
    )
    op.create_index(
        "ix_human_directory_settings_human_id",
        "human_directory_settings",
        ["human_id"],
    )
    op.create_index(
        "ix_human_directory_settings_popup_id",
        "human_directory_settings",
        ["popup_id"],
    )
    add_tenant_table_permissions("human_directory_settings")
    op.execute(
        "INSERT INTO human_directory_settings "
        "(id, tenant_id, human_id, popup_id, listed, shared_fields) "
        "SELECT gen_random_uuid(), at.tenant_id, at.human_id, at.popup_id, true, "
        "ARRAY(SELECT field FROM unnest(ARRAY['first_name','last_name','email',"
        "'telegram']::text[]) AS field "
        "WHERE NOT EXISTS (SELECT 1 FROM applications a "
        "CROSS JOIN unnest(a.info_not_shared) AS hidden "
        "WHERE a.human_id = at.human_id AND a.popup_id = at.popup_id "
        "AND lower(btrim(hidden)) IN (field, CASE field "
        "WHEN 'role' THEN 'role_in_the_organization' "
        "WHEN 'organization' THEN 'organization_you_represent' "
        "ELSE field END))) "
        "FROM attendees at JOIN humans h ON h.id = at.human_id "
        "JOIN attendee_categories ac ON ac.id = at.category_id "
        "WHERE ac.directory_eligible = true "
        "AND EXISTS (SELECT 1 FROM applications a0 "
        "WHERE a0.human_id = at.human_id AND a0.popup_id = at.popup_id) "
        "ON CONFLICT (human_id, popup_id) DO NOTHING"
    )


def downgrade() -> None:
    remove_tenant_table_permissions("human_directory_settings")
    op.drop_index(
        "ix_human_directory_settings_popup_id", table_name="human_directory_settings"
    )
    op.drop_index(
        "ix_human_directory_settings_human_id", table_name="human_directory_settings"
    )
    op.drop_index(
        "ix_human_directory_settings_tenant_id", table_name="human_directory_settings"
    )
    op.drop_table("human_directory_settings")
    op.drop_column("attendee_categories", "directory_eligible")
    op.drop_column("popups", "directory_fields")
