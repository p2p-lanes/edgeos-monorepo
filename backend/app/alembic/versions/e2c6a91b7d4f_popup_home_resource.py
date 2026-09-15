"""Move popup home documents to their own tenant-scoped resource.

Revision ID: e2c6a91b7d4f
Revises: a7c9e2f4b6d8
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e2c6a91b7d4f"
down_revision = "a7c9e2f4b6d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "popup_home_pages",
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("html", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("popup_id"),
    )
    op.create_index(
        "ix_popup_home_pages_tenant_id",
        "popup_home_pages",
        ["tenant_id"],
        unique=False,
    )

    # Preserve drafts as well as published homes before removing the wide
    # column from normal popup rows.
    op.execute(
        """
        INSERT INTO popup_home_pages (popup_id, tenant_id, html)
        SELECT id, tenant_id, custom_home_html
        FROM popups
        WHERE custom_home_html IS NOT NULL
        """
    )
    op.drop_column("popups", "custom_home_html")

    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE popup_home_pages TO tenant_role"
    )
    op.execute("GRANT SELECT ON TABLE popup_home_pages TO tenant_viewer_role")

    op.execute("ALTER TABLE popup_home_pages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE popup_home_pages FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy_popup_home_pages
        ON popup_home_pages
        USING (
            tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid)
        )
        WITH CHECK (
            tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid)
        )
        """
    )


def downgrade() -> None:
    op.add_column(
        "popups",
        sa.Column("custom_home_html", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE popups
        SET custom_home_html = popup_home_pages.html
        FROM popup_home_pages
        WHERE popup_home_pages.popup_id = popups.id
        """
    )
    op.execute(
        "DROP POLICY IF EXISTS tenant_isolation_policy_popup_home_pages "
        "ON popup_home_pages"
    )
    op.drop_index("ix_popup_home_pages_tenant_id", table_name="popup_home_pages")
    op.drop_table("popup_home_pages")
