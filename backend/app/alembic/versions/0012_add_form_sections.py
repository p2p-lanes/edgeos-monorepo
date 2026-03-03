"""Add form_sections table, migrate formfields.section to section_id FK

Revision ID: 0012_add_form_sections
Revises: 086f8872b3fb
Create Date: 2026-03-03

"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = "0012_add_form_sections"
down_revision = "086f8872b3fb"
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create form_sections table
    op.create_table(
        "formsections",
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
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
    )

    # Grants
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE formsections TO tenant_role"
    )
    op.execute("GRANT SELECT ON TABLE formsections TO tenant_viewer_role")

    # RLS policy
    op.execute("ALTER TABLE formsections ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy_formsections ON formsections
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid));
        """
    )

    # 2. Add section_id column to formfields
    op.add_column(
        "formfields",
        sa.Column(
            "section_id",
            UUID(as_uuid=True),
            sa.ForeignKey("formsections.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # 3. Migrate existing section strings to formsections records
    op.execute(
        """
        INSERT INTO formsections (id, tenant_id, popup_id, label, "order")
        SELECT gen_random_uuid(), tenant_id, popup_id, section,
               (ROW_NUMBER() OVER (PARTITION BY popup_id ORDER BY section) - 1)::int
        FROM (
            SELECT DISTINCT tenant_id, popup_id, section
            FROM formfields
            WHERE section IS NOT NULL AND section != ''
        ) AS unique_sections;
        """
    )

    # 4. Update formfields.section_id to reference the new records
    op.execute(
        """
        UPDATE formfields f
        SET section_id = s.id
        FROM formsections s
        WHERE f.section = s.label
          AND f.popup_id = s.popup_id
          AND f.section IS NOT NULL
          AND f.section != '';
        """
    )

    # 5. Drop the old section column
    op.drop_column("formfields", "section")

    # 6. Add index on section_id for faster lookups
    op.create_index("ix_formfields_section_id", "formfields", ["section_id"])


def downgrade():
    # 1. Re-add section column
    op.add_column(
        "formfields",
        sa.Column("section", sa.String(100), nullable=True),
    )

    # 2. Copy section labels back from formsections
    op.execute(
        """
        UPDATE formfields f
        SET section = s.label
        FROM formsections s
        WHERE f.section_id = s.id;
        """
    )

    # 3. Drop section_id column and index
    op.drop_index("ix_formfields_section_id", table_name="formfields")
    op.drop_column("formfields", "section_id")

    # 4. Drop formsections table
    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation_policy_formsections ON formsections"
    )
    op.drop_table("formsections")
