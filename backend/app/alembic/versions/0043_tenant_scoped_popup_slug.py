"""Tenant-scoped popup slug uniqueness.

Drops the global UNIQUE on popups.slug and replaces it with a composite
UNIQUE(tenant_id, slug) so two tenants can own the same slug.

The composite index is built CONCURRENTLY to avoid write locks.

Revision ID: 0043_tenant_scoped_popup_slug
Revises: 0042_popup_events_enabled
Create Date: 2026-05-04
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0043_tenant_scoped_popup_slug"
down_revision: str = "0042_popup_events_enabled"
branch_labels = None
depends_on = None


def _is_transactional_connection() -> bool:
    """Return True when running inside an already-open transaction.

    When alembic is invoked from tests, the caller passes an explicit
    connection (already inside a BEGIN block) via
    alembic_cfg.attributes["connection"]. autocommit_block() asserts
    that the connection is NOT already in a transaction and raises
    AssertionError if it is. We detect this so we can skip CONCURRENTLY
    in that context (safe for tests; the table is empty).
    """
    bind = op.get_bind()
    return bind.in_transaction()


def upgrade() -> None:
    # 1. Build new composite unique index.
    #    Use CONCURRENTLY in production (no write lock).
    #    Fall back to plain CREATE in test environments where the connection
    #    is already inside a transaction (CONCURRENTLY requires autocommit).
    if _is_transactional_connection():
        op.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "uq_popups_tenant_slug ON popups (tenant_id, slug)"
        )
    else:
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "
                "uq_popups_tenant_slug ON popups (tenant_id, slug)"
            )

    # 2. Drop the legacy global unique constraint if it exists.
    #    SQLAlchemy's Field(unique=True) generates popups_slug_key.
    #    Guard with IF EXISTS because some DB states may not have it.
    op.execute(
        "ALTER TABLE popups DROP CONSTRAINT IF EXISTS popups_slug_key"
    )

    # 3. Drop the old unique index on slug alone (Field(unique=True, index=True)
    #    generates both a constraint and a separate index).
    op.execute("DROP INDEX IF EXISTS ix_popups_slug")

    # 4. Re-create a non-unique index on slug for fast single-column lookups.
    op.create_index("ix_popups_slug", "popups", ["slug"])


def downgrade() -> None:
    # SAFETY: refuse to downgrade if cross-tenant duplicates exist.
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT slug FROM popups GROUP BY slug HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if result is not None:
        raise RuntimeError(
            f"Cannot downgrade: cross-tenant duplicate slug detected ({result[0]!r}). "
            "Resolve duplicates manually before re-creating the global UNIQUE constraint."
        )

    op.drop_index("ix_popups_slug", table_name="popups")

    if _is_transactional_connection():
        op.execute("DROP INDEX IF EXISTS uq_popups_tenant_slug")
    else:
        with op.get_context().autocommit_block():
            op.execute("DROP INDEX CONCURRENTLY IF EXISTS uq_popups_tenant_slug")

    op.create_index("ix_popups_slug", "popups", ["slug"], unique=True)
    op.create_unique_constraint("popups_slug_key", "popups", ["slug"])
