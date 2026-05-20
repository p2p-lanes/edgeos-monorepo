"""Add third-party OTP columns and dual-owner api_keys support.

WHY:
1. tenants.third_party_api_key_hash / third_party_key_prefix — allows a
   tenant to enable the third-party OTP surface by storing a bcrypt hash of
   the shared secret. Presence of a non-null hash = feature enabled.
2. api_keys.user_id — admin-owned API keys. Exactly one of (human_id,
   user_id) must be non-null, enforced by the api_keys_owner_check constraint.
3. api_keys.human_id nullable — required so that admin-owned rows (user_id
   set, human_id NULL) satisfy the constraint.

WHAT:
1. ADD COLUMN tenants.third_party_api_key_hash (String 64, nullable)
2. ADD COLUMN tenants.third_party_key_prefix (String 20, nullable)
3. CREATE UNIQUE INDEX ix_tenants_third_party_api_key_hash on tenants
   (third_party_api_key_hash) WHERE third_party_api_key_hash IS NOT NULL
4. ADD COLUMN api_keys.user_id (UUID, FK users.id CASCADE, nullable)
5. ALTER COLUMN api_keys.human_id SET NULL (drop NOT NULL)
6. CREATE INDEX ix_api_keys_user_revoked ON api_keys(user_id, revoked_at)
7. ADD CONSTRAINT api_keys_owner_check CHECK ((human_id IS NULL) <> (user_id IS NULL))

No data backfill needed: existing rows all have human_id set and user_id NULL,
which already satisfies the CHECK constraint.

RLS note: api_keys already has tenant_id with existing RLS grants. Column
additions do not change RLS policies — no re-grant needed. The tenants columns
are additions to an existing table, not a new table, so add_tenant_table_permissions
is NOT called.

Revision ID: 5e5739582c92
Revises: d8f2e4a9c1b6
Create Date: 2026-05-19
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "5e5739582c92"
down_revision = "d8f2e4a9c1b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1 & 2. Add third-party columns to tenants.
    op.add_column(
        "tenants",
        sa.Column("third_party_api_key_hash", sa.String(64), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("third_party_key_prefix", sa.String(20), nullable=True),
    )

    # 3. Partial unique index on the third-party key hash. Lets the login flow
    #    resolve the tenant from the key alone (no X-Tenant-Id header) and
    #    guarantees no two tenants ever share the same key hash.
    op.create_index(
        "ix_tenants_third_party_api_key_hash",
        "tenants",
        ["third_party_api_key_hash"],
        unique=True,
        postgresql_where=sa.text("third_party_api_key_hash IS NOT NULL"),
    )

    # 4. Add user_id FK column to api_keys (admin-owned key owner).
    op.add_column(
        "api_keys",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )

    # 5. Drop NOT NULL from api_keys.human_id (admin rows have NULL human_id).
    op.alter_column("api_keys", "human_id", existing_type=sa.Uuid(), nullable=True)

    # 6. Index for admin-key lookups by owner + revocation status.
    op.create_index(
        "ix_api_keys_user_revoked",
        "api_keys",
        ["user_id", "revoked_at"],
    )

    # 7. XOR ownership constraint via raw SQL (DDL — no bind params needed).
    #    (human_id IS NULL) <> (user_id IS NULL) is true only when exactly one
    #    of them is non-null, rejecting both-null and both-set rows.
    op.execute(
        "ALTER TABLE api_keys ADD CONSTRAINT api_keys_owner_check "
        "CHECK ((human_id IS NULL) <> (user_id IS NULL))"
    )


def downgrade() -> None:
    # 1. Drop the XOR constraint before restoring NOT NULL on human_id.
    op.execute("ALTER TABLE api_keys DROP CONSTRAINT api_keys_owner_check")

    # 2. Drop the user index.
    op.drop_index("ix_api_keys_user_revoked", table_name="api_keys")

    # 3. Guard: refuse downgrade if any admin-owned keys exist (human_id IS NULL).
    #    Downgrading would orphan those rows because human_id NOT NULL is about
    #    to be restored.
    conn = op.get_bind()
    admin_count = conn.execute(
        sa.text("SELECT COUNT(*) FROM api_keys WHERE human_id IS NULL")
    ).scalar()
    if admin_count and admin_count > 0:
        raise RuntimeError(
            f"Cannot downgrade: {admin_count} admin-owned api_keys exist "
            "(human_id IS NULL). Revoke or delete them first."
        )

    # 4. Restore NOT NULL on human_id (all remaining rows have human_id set).
    op.alter_column(
        "api_keys", "human_id", existing_type=sa.Uuid(), nullable=False
    )

    # 5. Drop user_id column.
    op.drop_column("api_keys", "user_id")

    # 6. Drop the partial unique index on the third-party key hash.
    op.drop_index("ix_tenants_third_party_api_key_hash", table_name="tenants")

    # 7. Drop tenant third-party columns (in reverse order).
    op.drop_column("tenants", "third_party_key_prefix")
    op.drop_column("tenants", "third_party_api_key_hash")
