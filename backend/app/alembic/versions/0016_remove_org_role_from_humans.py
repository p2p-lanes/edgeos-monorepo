"""Remove organization and role columns from humans table.

Migrate existing values to applications.custom_fields and create FormFields
for popups that have applications with non-null organization/role values.

Revision ID: 0016_remove_org_role
Revises: 0015_add_cart_credit_insurance
Create Date: 2026-03-05

"""

import sqlalchemy as sa
from alembic import op

revision = "0016_remove_org_role"
down_revision = "0015_add_cart_credit_insurance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Step 1: Copy organization/role values from humans to applications.custom_fields
    # For each application whose human has non-null organization or role,
    # merge those values into the application's custom_fields JSONB.
    conn.execute(
        sa.text("""
            UPDATE applications a
            SET custom_fields = a.custom_fields
                || jsonb_build_object('organization', h.organization)
            FROM humans h
            WHERE a.human_id = h.id
              AND h.organization IS NOT NULL
              AND h.organization != ''
              AND NOT (a.custom_fields ? 'organization')
        """)
    )
    conn.execute(
        sa.text("""
            UPDATE applications a
            SET custom_fields = a.custom_fields
                || jsonb_build_object('role', h.role)
            FROM humans h
            WHERE a.human_id = h.id
              AND h.role IS NOT NULL
              AND h.role != ''
              AND NOT (a.custom_fields ? 'role')
        """)
    )

    # Step 2: Create FormFields for each popup that has applications with
    # non-null organization/role. Assign them to the first section if one exists.
    # We use a CTE to find distinct popups that need these fields.
    for field_name, field_label in [("organization", "Organization"), ("role", "Role")]:
        conn.execute(
            sa.text(f"""
                INSERT INTO formfields (id, tenant_id, popup_id, name, label, field_type, position, required, section_id)
                SELECT
                    gen_random_uuid(),
                    p.tenant_id,
                    p.id,
                    '{field_name}',
                    '{field_label}',
                    'text',
                    CASE WHEN '{field_name}' = 'organization' THEN 900 ELSE 901 END,
                    false,
                    (
                        SELECT fs.id FROM formsections fs
                        WHERE fs.popup_id = p.id
                        ORDER BY fs."order" ASC
                        LIMIT 1
                    )
                FROM popups p
                WHERE EXISTS (
                    SELECT 1 FROM applications a
                    JOIN humans h ON a.human_id = h.id
                    WHERE a.popup_id = p.id
                      AND h.{field_name} IS NOT NULL
                      AND h.{field_name} != ''
                )
                AND NOT EXISTS (
                    SELECT 1 FROM formfields ff
                    WHERE ff.popup_id = p.id AND ff.name = '{field_name}'
                )
            """)
        )

    # Step 3: Drop columns from humans
    op.drop_column("humans", "organization")
    op.drop_column("humans", "role")

    # Step 4: Drop columns from application_snapshots
    op.drop_column("application_snapshots", "organization")
    op.drop_column("application_snapshots", "role")


def downgrade() -> None:
    conn = op.get_bind()

    # Step 1: Add columns back to humans and application_snapshots
    op.add_column(
        "humans",
        sa.Column("organization", sa.String(255), nullable=True),
    )
    op.add_column(
        "humans",
        sa.Column("role", sa.String(255), nullable=True),
    )
    op.add_column(
        "application_snapshots",
        sa.Column("organization", sa.String(255), nullable=True),
    )
    op.add_column(
        "application_snapshots",
        sa.Column("role", sa.String(255), nullable=True),
    )

    # Step 2: Copy values back from applications.custom_fields to humans
    # Use the most recent application per human to restore the values
    conn.execute(
        sa.text("""
            UPDATE humans h
            SET organization = sub.org
            FROM (
                SELECT DISTINCT ON (human_id)
                    human_id,
                    custom_fields->>'organization' as org
                FROM applications
                WHERE custom_fields->>'organization' IS NOT NULL
                ORDER BY human_id, updated_at DESC
            ) sub
            WHERE h.id = sub.human_id
        """)
    )
    conn.execute(
        sa.text("""
            UPDATE humans h
            SET role = sub.role_val
            FROM (
                SELECT DISTINCT ON (human_id)
                    human_id,
                    custom_fields->>'role' as role_val
                FROM applications
                WHERE custom_fields->>'role' IS NOT NULL
                ORDER BY human_id, updated_at DESC
            ) sub
            WHERE h.id = sub.human_id
        """)
    )

    # Step 3: Remove the FormFields we created (only auto-created ones at position 900/901)
    conn.execute(
        sa.text("""
            DELETE FROM formfields
            WHERE name IN ('organization', 'role')
              AND position IN (900, 901)
        """)
    )

    # Step 4: Remove organization/role keys from custom_fields
    conn.execute(
        sa.text("""
            UPDATE applications
            SET custom_fields = custom_fields - 'organization' - 'role'
            WHERE custom_fields ? 'organization' OR custom_fields ? 'role'
        """)
    )
