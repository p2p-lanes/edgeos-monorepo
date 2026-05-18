"""Close GUC bypass via session_user-derived effective tenant.

WHY: Holders of usr_<hex> credentials were able to escape their tenant scope
by issuing SET app.tenant_id = '<other-tenant-uuid>' before running queries,
because all RLS policies evaluated the client-controlled GUC directly.
This migration closes that gap: a new SECURITY DEFINER function
(public.app_effective_tenant_id) looks up the caller's tenant_id from
tenant_credentials WHERE db_username = session_user. Because session_user
is the immutable LOGIN identity (immune to SET ROLE), a tenant credential
holder cannot escape their scope regardless of GUC manipulation.

WHAT:
1. ADD UNIQUE constraint on tenant_credentials.db_username:the function
   relies on at most one row per session_user; enforce that invariant at
   the DB level before the function exists.
2. CREATE FUNCTION public.app_effective_tenant_id():SECURITY DEFINER,
   STABLE, search_path pinned to pg_catalog,public.
3. Discover and rewrite every existing tenant isolation policy
   (pattern 'tenant_isolation%') to call the function instead of reading
   current_setting('app.tenant_id', true)::uuid. The list is queried from
   pg_policies at runtime so this migration adapts to whatever set of
   policies actually exists in the target database (dev vs prod may differ).
4. ENABLE RLS on tenants table + add per-row scoping policy.

GRANT / REVOKE:
- REVOKE ALL ON FUNCTION ... FROM PUBLIC (default PUBLIC grant removed)
- GRANT EXECUTE TO tenant_role, tenant_viewer_role only

Pre-deploy prod check: run
  SELECT db_username, count(*) FROM tenant_credentials
  GROUP BY db_username HAVING count(*) > 1;
must return zero rows before running this migration.

Revision ID: a5601e8133cb
Revises: 0050_venue_display_order
Create Date: 2026-05-18
"""

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "a5601e8133cb"
down_revision = "0050_venue_display_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add UNIQUE constraint on tenant_credentials.db_username.
    #    First, because the function assumes at most one row per session_user.
    #    If the data is dirty, the constraint add fails here and the entire
    #    transaction rolls back cleanly before any policies are touched.
    op.execute(
        "ALTER TABLE public.tenant_credentials "
        "ADD CONSTRAINT uq_tenant_credentials_db_username UNIQUE (db_username)"
    )

    # 2. Create the SECURITY DEFINER function that resolves tenant_id from
    #    session_user (the immutable login identity). The COALESCE fallback
    #    serves the platform-owner path (no tenant_credentials row) and the
    #    ticket_events FORCE RLS path, both of which set app.tenant_id via
    #    the TenantConnectionManager checkout listener.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.app_effective_tenant_id() RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = pg_catalog, public
        AS $$
          SELECT COALESCE(
            (SELECT tc.tenant_id
               FROM public.tenant_credentials tc
               WHERE tc.db_username = session_user),
            NULLIF(current_setting('app.tenant_id', true), '')::uuid
          );
        $$;
        """
    )

    # Grant: revoke from PUBLIC (default), then allow only tenant roles.
    op.execute(
        "REVOKE ALL ON FUNCTION public.app_effective_tenant_id() FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.app_effective_tenant_id() "
        "TO tenant_role, tenant_viewer_role"
    )

    # 3. Discover and rewrite every existing tenant isolation policy.
    #    We query pg_policies at runtime instead of hardcoding a table list
    #    because policy names vary across the codebase (some use the canonical
    #    `tenant_isolation_policy_<table>` form, others use bespoke names like
    #    `tenant_isolation_application_reviews`). The pattern `tenant_isolation%`
    #    catches all of them; we drop each by its actual name and recreate
    #    the canonical one calling app_effective_tenant_id().
    bind = op.get_bind()
    existing_policies = bind.execute(
        text(
            "SELECT tablename, policyname FROM pg_policies "
            "WHERE schemaname = 'public' AND policyname LIKE 'tenant_isolation%' "
            "ORDER BY tablename, policyname"
        )
    ).fetchall()

    for tablename, policyname in existing_policies:
        canonical = f"tenant_isolation_policy_{tablename}"
        op.execute(f'DROP POLICY IF EXISTS "{policyname}" ON public."{tablename}"')
        op.execute(
            f"""
            CREATE POLICY {canonical} ON public.{tablename}
              USING      (tenant_id = (SELECT public.app_effective_tenant_id()))
              WITH CHECK (tenant_id = (SELECT public.app_effective_tenant_id()))
            """
        )

    # 4. Enable RLS on tenants + per-row scoping policy.
    #    USING-only (no WITH CHECK):tenant_role has no INSERT/UPDATE/DELETE
    #    on tenants, so WITH CHECK is not needed.
    #    No FORCE RLS: the platform owner must continue to read all tenants
    #    from migrations and admin scripts.
    op.execute("ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy_tenants ON public.tenants
          USING (id = (SELECT public.app_effective_tenant_id()))
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "a5601e8133cb_session_user_tenant_isolation is a forward-only migration. "
        "Downgrade is not implemented:reverting would re-expose the GUC "
        "bypass that this migration closes."
    )
