"""Popup third-party SSO configuration and single-use codes.

Revision ID: b5e7a9c1d3f2
Revises: a4f6b8d2c9e1
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b5e7a9c1d3f2"
down_revision = "a4f6b8d2c9e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "third_party_apps", sa.Column("sso_start_url", sa.String(2048), nullable=True)
    )
    op.add_column(
        "third_party_apps",
        sa.Column("sso_redirect_uri", sa.String(2048), nullable=True),
    )
    op.create_table(
        "popup_third_party_apps",
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "app_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("third_party_apps.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.create_table(
        "third_party_authorization_codes",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "human_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("humans.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "app_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("third_party_apps.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "popup_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("popups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("code_challenge", sa.String(43), nullable=False),
        sa.Column("scopes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_third_party_authorization_codes_expires_at",
        "third_party_authorization_codes",
        ["expires_at"],
    )
    for table in ("popup_third_party_apps", "third_party_authorization_codes"):
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
        op.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {table} TO tenant_role"
        )
        op.execute(f"GRANT SELECT ON TABLE {table} TO tenant_viewer_role")
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY tenant_isolation_policy_{table} ON {table}
            USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
            WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))""")


def downgrade() -> None:
    op.drop_table("third_party_authorization_codes")
    op.drop_table("popup_third_party_apps")
    op.drop_column("third_party_apps", "sso_redirect_uri")
    op.drop_column("third_party_apps", "sso_start_url")
