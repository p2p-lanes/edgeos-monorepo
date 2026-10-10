"""Revocable third-party grants and rotating, hashed refresh tokens.

Revision ID: a1d3f5b7c9e2
Revises: f0fbedba955c
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "a1d3f5b7c9e2"
down_revision = "f0fbedba955c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "third_party_grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
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
            nullable=True,
        ),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("redirect_uri", sa.String(2048), nullable=True),
        sa.Column("scopes", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(origin = 'otp' AND popup_id IS NULL AND redirect_uri IS NULL) OR "
            "(origin = 'sso' AND popup_id IS NOT NULL AND redirect_uri IS NOT NULL)",
            name="third_party_grant_origin_check",
        ),
    )
    for column in ("tenant_id", "human_id", "app_id", "expires_at"):
        op.create_index(
            f"ix_third_party_grants_{column}", "third_party_grants", [column]
        )
    op.create_table(
        "third_party_refresh_tokens",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "grant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("third_party_grants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_third_party_refresh_tokens_grant_id",
        "third_party_refresh_tokens",
        ["grant_id"],
    )
    # Credentials and consent state are backend-private. Do not let tenant
    # application/viewer roles read hashes or rewrite authorization snapshots.
    for table in ("third_party_grants", "third_party_refresh_tokens"):
        op.execute(
            f"REVOKE ALL ON TABLE {table} FROM PUBLIC, tenant_role, tenant_viewer_role"
        )
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY tenant_isolation_policy_third_party_grants ON third_party_grants
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))""")
    op.execute("""CREATE POLICY tenant_isolation_policy_third_party_refresh_tokens ON third_party_refresh_tokens
        USING (EXISTS (SELECT 1 FROM third_party_grants g WHERE g.id = grant_id
            AND g.tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid)))
        WITH CHECK (EXISTS (SELECT 1 FROM third_party_grants g WHERE g.id = grant_id
            AND g.tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid)))""")


def downgrade() -> None:
    op.drop_table("third_party_refresh_tokens")
    op.drop_table("third_party_grants")
