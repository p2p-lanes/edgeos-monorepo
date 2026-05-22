"""Create third_party_apps table and backfill from tenants single-key columns.

WHY:
v1 stored a single third-party API key per tenant in
`tenants.third_party_api_key_hash` + `third_party_key_prefix`. The new model
supports N apps per tenant with per-app scope subsets — one row per
registered integration. Each pre-existing tenant key becomes one legacy
app row so beta integrations (e.g. Openclaw) keep working across the
deploy without rotation.

WHAT (upgrade):
1. CREATE TABLE third_party_apps with the per-app shape (RLS via
   add_tenant_table_permissions).
2. CREATE PARTIAL UNIQUE INDEX on (tenant_id, lower(name)) WHERE
   revoked_at IS NULL — enforces at most one active row per (tenant, name).
3. Backfill: each `tenants.third_party_api_key_hash IS NOT NULL` becomes a
   `name='legacy'` row with v1 default token + api_key scopes. Prefix
   falls back to the first 8 hex chars of the hash if the v1 prefix was
   never populated.
4. Drop the v1 partial unique index on `tenants.third_party_api_key_hash`.
5. ALTER TABLE tenants DROP COLUMN third_party_api_key_hash,
   third_party_key_prefix.

Downgrade reverses all of the above and refuses if any tenant has more
than one active third-party app (would lose data on collapse to a single
column).

Revision ID: c0b101dd74e8
Revises: a1f9c2e8b5d1
Create Date: 2026-05-21
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "c0b101dd74e8"
down_revision = "a1f9c2e8b5d1"
branch_labels = None
depends_on = None


_V1_DEFAULT_TOKEN_SCOPES = (
    '["portal:self_read","portal:directory_read","portal:api_keys_manage"]'
)
_V1_DEFAULT_API_KEY_SCOPES = '["events:read","rsvp:write"]'


def upgrade() -> None:
    # 1. Create the new table.
    op.create_table(
        "third_party_apps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("prefix", sa.String(length=20), nullable=False),
        sa.Column(
            "allowed_token_scopes",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "allowed_api_key_scopes",
            JSONB,
            nullable=False,
            server_default="[]",
        ),
        sa.Column(
            "active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    # Tenant-scoped RLS for the new table (SELECT/INSERT/UPDATE/DELETE
    # via app.tenant_id GUC). Same pattern as every other tenant table.
    add_tenant_table_permissions("third_party_apps")

    # 2. Index for active-list queries (scoped to non-revoked rows).
    op.create_index(
        "ix_third_party_apps_tenant_active",
        "third_party_apps",
        ["tenant_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )

    # 3. Functional partial unique index on (tenant_id, lower(name)) for
    #    active rows. Declared in DDL since SQLAlchemy cannot express a
    #    functional + partial UNIQUE portably.
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX ix_third_party_apps_tenant_name_unique "
            "ON third_party_apps (tenant_id, lower(name)) "
            "WHERE revoked_at IS NULL"
        )
    )

    # 4. Backfill from tenants single-key columns. Each pre-existing tenant
    #    with third_party_api_key_hash IS NOT NULL becomes one 'legacy' app
    #    row. Prefix falls back to first 8 chars of the hash if missing.
    op.execute(
        sa.text(
            "INSERT INTO third_party_apps ("
            "id, tenant_id, name, key_hash, prefix,"
            " allowed_token_scopes, allowed_api_key_scopes,"
            " active, created_at, updated_at"
            ") "
            "SELECT "
            "  gen_random_uuid(), id, 'legacy',"
            "  third_party_api_key_hash,"
            "  COALESCE(third_party_key_prefix, SUBSTRING(third_party_api_key_hash FOR 8)),"
            f" '{_V1_DEFAULT_TOKEN_SCOPES}'::jsonb,"
            f" '{_V1_DEFAULT_API_KEY_SCOPES}'::jsonb,"
            "  true, now(), now() "
            "FROM tenants "
            "WHERE third_party_api_key_hash IS NOT NULL"
        )
    )

    # 5. Drop the v1 partial unique index on tenants.third_party_api_key_hash.
    op.drop_index(
        "ix_tenants_third_party_api_key_hash",
        table_name="tenants",
    )

    # 6. Drop the v1 tenant columns. From here on, third-party state lives
    #    exclusively in third_party_apps.
    op.drop_column("tenants", "third_party_key_prefix")
    op.drop_column("tenants", "third_party_api_key_hash")


def downgrade() -> None:
    # 1. Guard: refuse downgrade if any tenant has more than one active app —
    #    we can't collapse N rows back into a single tenant column.
    conn = op.get_bind()
    multi_app = conn.execute(
        sa.text(
            "SELECT tenant_id, COUNT(*) c "
            "FROM third_party_apps "
            "WHERE revoked_at IS NULL "
            "GROUP BY tenant_id "
            "HAVING COUNT(*) > 1 "
            "LIMIT 1"
        )
    ).first()
    if multi_app is not None:
        raise RuntimeError(
            f"Cannot downgrade: tenant {multi_app[0]} has {multi_app[1]} "
            "active third-party apps. Soft-delete extras first."
        )

    # 2. Restore tenant columns.
    op.add_column(
        "tenants",
        sa.Column("third_party_api_key_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("third_party_key_prefix", sa.String(length=20), nullable=True),
    )

    # 3. Restore the v1 partial unique index.
    op.create_index(
        "ix_tenants_third_party_api_key_hash",
        "tenants",
        ["third_party_api_key_hash"],
        unique=True,
        postgresql_where=sa.text("third_party_api_key_hash IS NOT NULL"),
    )

    # 4. Backfill the tenant columns from the surviving (legacy) app row, if any.
    op.execute(
        sa.text(
            "UPDATE tenants t SET "
            "  third_party_api_key_hash = a.key_hash,"
            "  third_party_key_prefix = a.prefix "
            "FROM third_party_apps a "
            "WHERE a.tenant_id = t.id AND a.revoked_at IS NULL"
        )
    )

    # 5. Drop the new table (RLS grants drop first, then table).
    remove_tenant_table_permissions("third_party_apps")

    op.drop_index(
        "ix_third_party_apps_tenant_name_unique",
        table_name="third_party_apps",
    )
    op.drop_index(
        "ix_third_party_apps_tenant_active",
        table_name="third_party_apps",
    )
    op.drop_table("third_party_apps")
