import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from testcontainers.postgres import PostgresContainer

from app.api.popup.models import Popups
from app.api.shared.enums import CredentialType
from app.api.tenant.credential_models import TenantCredentials
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.utils.encryption import decrypt


class TestViewerReadonlyAccess:
    def test_viewer_cannot_list_popups(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Viewer cannot list popups — GET /popups is now gated to CurrentCheckInOperator."""
        response = client.get(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        )

        assert response.status_code == 403

    def test_viewer_cannot_get_popup_by_id(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Viewer cannot get popup by ID — GET /popups/{id} gated to CurrentCheckInOperator."""
        response = client.get(
            f"/api/v1/popups/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        )

        assert response.status_code == 403

    def test_viewer_cannot_create_popup(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Viewer should NOT be able to create popups (no INSERT permission)."""
        response = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
            json={
                "name": f"Viewer Popup {uuid.uuid4().hex[:8]}",
                "tenant_id": str(tenant_a.id),
            },
        )

        # Should be blocked at API level (403) or database level (403)
        assert response.status_code == 403

    def test_viewer_cannot_update_popup(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Viewer should NOT be able to update popups (no UPDATE permission)."""
        response = client.patch(
            f"/api/v1/popups/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
            json={"name": "Updated by Viewer"},
        )

        # Should be blocked at API level (403) or database level (403)
        assert response.status_code == 403

    def test_viewer_cannot_delete_popup(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Viewer should NOT be able to delete popups (no DELETE permission)."""
        response = client.delete(
            f"/api/v1/popups/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        )

        # Should be blocked at API level (403) or database level (403)
        assert response.status_code == 403

    def test_viewer_cannot_see_other_tenant_popups(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_b: Popups,
    ) -> None:
        """Viewer cannot reach popup endpoint at all (gated to CurrentCheckInOperator).

        Previously this tested RLS blocking cross-tenant reads (404). Now the dep
        itself rejects VIEWER before RLS is evaluated, so the response is 403.
        """
        response = client.get(
            f"/api/v1/popups/{popup_tenant_b.id}",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        )

        # Dep rejects VIEWER with 403 before RLS is evaluated
        assert response.status_code == 403


class TestPopupRLS:
    def test_superadmin_sees_tenant_popups_with_header(
        self,
        client: TestClient,
        superadmin_token: str,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """Superadmin should see popups from a specific tenant when providing X-Tenant-Id."""
        # Access Tenant A popups
        response_a = client.get(
            "/api/v1/popups",
            params={"search": "Popup Tenant"},
            headers={
                "Authorization": f"Bearer {superadmin_token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
        )
        assert response_a.status_code == 200
        popup_ids_a = [p["id"] for p in response_a.json()["results"]]
        assert str(popup_tenant_a.id) in popup_ids_a
        assert str(popup_tenant_b.id) not in popup_ids_a

        # Access Tenant B popups
        response_b = client.get(
            "/api/v1/popups",
            params={"search": "Popup Tenant"},
            headers={
                "Authorization": f"Bearer {superadmin_token}",
                "X-Tenant-Id": str(tenant_b.id),
            },
        )
        assert response_b.status_code == 200
        popup_ids_b = [p["id"] for p in response_b.json()["results"]]
        assert str(popup_tenant_b.id) in popup_ids_b
        assert str(popup_tenant_a.id) not in popup_ids_b

    def test_superadmin_requires_tenant_header_for_popups(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """Superadmin should get 400 when accessing tenant-scoped data without X-Tenant-Id."""
        response = client.get(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {superadmin_token}"},
        )
        assert response.status_code == 400
        assert "X-Tenant-Id" in response.json()["detail"]

    def test_tenant_a_sees_only_own_popups(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """Tenant A admin should only see Tenant A popups."""
        response = client.get(
            "/api/v1/popups",
            params={"search": "Popup Tenant"},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert response.status_code == 200
        data = response.json()

        popup_ids = [p["id"] for p in data["results"]]
        # Should see own popup
        assert str(popup_tenant_a.id) in popup_ids
        # Should NOT see other tenant's popup
        assert str(popup_tenant_b.id) not in popup_ids

    def test_tenant_b_sees_only_own_popups(
        self,
        client: TestClient,
        admin_token_tenant_b: str,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """Tenant B admin should only see Tenant B popups."""
        response = client.get(
            "/api/v1/popups",
            params={"search": "Popup Tenant"},
            headers={"Authorization": f"Bearer {admin_token_tenant_b}"},
        )

        assert response.status_code == 200
        data = response.json()

        popup_ids = [p["id"] for p in data["results"]]
        # Should see own popup
        assert str(popup_tenant_b.id) in popup_ids
        # Should NOT see other tenant's popup
        assert str(popup_tenant_a.id) not in popup_ids

    def test_tenant_a_cannot_get_tenant_b_popup_by_id(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_b: Popups,
    ) -> None:
        """Tenant A admin should not be able to access Tenant B popup by ID."""
        response = client.get(
            f"/api/v1/popups/{popup_tenant_b.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        # RLS should filter this out, returning 404
        assert response.status_code == 404

    def test_tenant_b_cannot_get_tenant_a_popup_by_id(
        self,
        client: TestClient,
        admin_token_tenant_b: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Tenant B admin should not be able to access Tenant A popup by ID."""
        response = client.get(
            f"/api/v1/popups/{popup_tenant_a.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_b}"},
        )

        # RLS should filter this out, returning 404
        assert response.status_code == 404

    def test_superadmin_can_get_any_popup_by_id(
        self,
        client: TestClient,
        superadmin_token: str,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """Superadmin should be able to access any popup by ID with X-Tenant-Id."""
        # Access Tenant A popup
        response_a = client.get(
            f"/api/v1/popups/{popup_tenant_a.id}",
            headers={
                "Authorization": f"Bearer {superadmin_token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
        )
        assert response_a.status_code == 200
        assert response_a.json()["id"] == str(popup_tenant_a.id)

        # Access Tenant B popup
        response_b = client.get(
            f"/api/v1/popups/{popup_tenant_b.id}",
            headers={
                "Authorization": f"Bearer {superadmin_token}",
                "X-Tenant-Id": str(tenant_b.id),
            },
        )
        assert response_b.status_code == 200
        assert response_b.json()["id"] == str(popup_tenant_b.id)

    def test_tenant_a_can_create_popup_for_own_tenant(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Tenant A admin should be able to create a popup for their tenant."""
        response = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "name": f"New Popup A {uuid.uuid4().hex[:8]}",
                "tenant_id": str(tenant_a.id),
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["tenant_id"] == str(tenant_a.id)

    def test_tenant_a_tenant_id_is_derived_not_from_input(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Tenant A admin's tenant_id is derived from their user, not from input.

        Even if they specify tenant B's ID, the popup is created with tenant A's ID.
        """
        response = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "name": f"Derived Tenant Popup {uuid.uuid4().hex[:8]}",
                "tenant_id": str(tenant_b.id),  # This should be ignored
            },
        )

        # The popup is created successfully but with tenant A's ID, not B's
        assert response.status_code == 201
        data = response.json()
        # The tenant_id should be derived from the current user's tenant
        assert data["tenant_id"] == str(tenant_a.id)
        assert data["tenant_id"] != str(tenant_b.id)

    def test_tenant_a_cannot_update_tenant_b_popup(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_b: Popups,
    ) -> None:
        """Tenant A admin should NOT be able to update Tenant B popup."""
        response = client.patch(
            f"/api/v1/popups/{popup_tenant_b.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"name": "Hacked Name"},
        )

        # RLS should filter this out, returning 404 (popup not found in tenant scope)
        assert response.status_code == 404

    def test_tenant_a_cannot_delete_tenant_b_popup(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_b: Popups,
    ) -> None:
        """Tenant A admin should NOT be able to delete Tenant B popup."""
        response = client.delete(
            f"/api/v1/popups/{popup_tenant_b.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        # RLS should filter this out, returning 404
        assert response.status_code == 404


class TestTenantEndpointsAccess:
    def test_tenant_admin_cannot_list_tenants(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Tenant admin should NOT be able to list all tenants."""
        response = client.get(
            "/api/v1/tenants",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert response.status_code == 403

    def test_tenant_admin_cannot_get_tenant_credentials(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Tenant admin should NOT be able to get tenant credentials."""
        response = client.get(
            f"/api/v1/tenants/{tenant_a.id}/credentials",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert response.status_code == 403

    def test_superadmin_can_list_tenants(
        self,
        client: TestClient,
        superadmin_token: str,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """Superadmin should be able to list all tenants."""
        response = client.get(
            "/api/v1/tenants",
            headers={"Authorization": f"Bearer {superadmin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        tenant_ids = [t["id"] for t in data["results"]]
        assert str(tenant_a.id) in tenant_ids
        assert str(tenant_b.id) in tenant_ids


class TestUserEndpointsAccess:
    def test_tenant_admin_can_list_own_tenant_users(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_user_tenant_a: Users,
    ) -> None:
        """Tenant admin should be able to list users in their own tenant."""
        response = client.get(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert response.status_code == 200
        data = response.json()
        # Should only see users from their own tenant
        user_ids = [u["id"] for u in data["results"]]
        assert str(admin_user_tenant_a.id) in user_ids

    def test_tenant_admin_can_get_own_info(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_user_tenant_a: Users,
    ) -> None:
        """Tenant admin should be able to get their own info via /me."""
        response = client.get(
            "/api/v1/users/me",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert response.status_code == 200
        assert response.json()["id"] == str(admin_user_tenant_a.id)

    def test_superadmin_can_list_users(
        self,
        client: TestClient,
        superadmin_token: str,
        admin_user_tenant_a: Users,
        admin_user_tenant_b: Users,
    ) -> None:
        """Superadmin should be able to list all users."""
        response = client.get(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {superadmin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        admin_ids = [a["id"] for a in data["results"]]
        assert str(admin_user_tenant_a.id) in admin_ids
        assert str(admin_user_tenant_b.id) in admin_ids


class TestRoleHierarchy:
    def test_admin_can_create_user(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Admin user should be able to create another user for their tenant."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "email": f"new-admin-{uuid.uuid4().hex[:8]}@test.com",
                "role": "admin",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "admin"
        # tenant_id should be derived from the creating admin
        assert data["tenant_id"] == str(tenant_a.id)

    def test_admin_can_create_viewer(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Admin should be able to create a viewer for their tenant."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "email": f"new-viewer-{uuid.uuid4().hex[:8]}@test.com",
                "role": "viewer",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "viewer"
        assert data["tenant_id"] == str(tenant_a.id)

    def test_admin_cannot_create_superadmin(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Admin should NOT be able to create a superadmin."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "email": f"evil-superadmin-{uuid.uuid4().hex[:8]}@test.com",
                "role": "superadmin",
            },
        )

        assert response.status_code == 403

    def test_viewer_cannot_create_any_user(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
    ) -> None:
        """Viewer user should NOT be able to create any user."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
            json={
                "email": f"viewer-created-{uuid.uuid4().hex[:8]}@test.com",
                "role": "viewer",
            },
        )

        assert response.status_code == 403

    def test_superadmin_can_create_superadmin(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """Superadmin should be able to create another superadmin."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {superadmin_token}"},
            json={
                "email": f"new-superadmin-{uuid.uuid4().hex[:8]}@test.com",
                "role": "superadmin",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "superadmin"
        assert data["tenant_id"] is None

    def test_superadmin_must_provide_tenant_id_for_non_superadmin(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """Superadmin must provide tenant_id when creating non-superadmin users."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {superadmin_token}"},
            json={
                "email": f"no-tenant-admin-{uuid.uuid4().hex[:8]}@test.com",
                "role": "admin",
                # No tenant_id provided
            },
        )

        assert response.status_code == 400

    def test_superadmin_can_create_admin_with_tenant_id(
        self,
        client: TestClient,
        superadmin_token: str,
        tenant_a: Tenants,
    ) -> None:
        """Superadmin should be able to create admin for any tenant."""
        response = client.post(
            "/api/v1/users",
            headers={"Authorization": f"Bearer {superadmin_token}"},
            json={
                "email": f"superadmin-created-{uuid.uuid4().hex[:8]}@test.com",
                "role": "admin",
                "tenant_id": str(tenant_a.id),
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["role"] == "admin"
        assert data["tenant_id"] == str(tenant_a.id)


def _get_tenant_dsn(
    db: Session,
    postgres_container: PostgresContainer,
    tenant_id: uuid.UUID,
    credential_type: CredentialType,
) -> str:
    """Build a libpq DSN for a tenant's usr_<hex> credential against the test container."""
    cred = db.exec(
        select(TenantCredentials).where(
            TenantCredentials.tenant_id == tenant_id,
            TenantCredentials.credential_type == credential_type,
        )
    ).first()
    assert cred is not None, f"No {credential_type} credential for tenant {tenant_id}"
    host = postgres_container.get_container_host_ip()
    port = int(postgres_container.get_exposed_port(5432))
    password = decrypt(cred.db_password_encrypted)
    return (
        f"host={host} port={port} dbname=test_db "
        f"user={cred.db_username} password={password} sslmode=disable"
    )


class TestSessionUserRLS:
    """Verify that session_user-derived tenant scope cannot be bypassed.

    These tests open raw psycopg connections as usr_<hex> credentials and
    exercise the attack vectors that existed before the
    a5601e8133cb_session_user_tenant_isolation migration. Every test should
    be green on a migrated DB and would fail on the old GUC-only policies.
    """

    def test_client_set_app_tenant_id_is_ignored(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """SET app.tenant_id to tenant B must not change the visible popup set.

        Covers SCENARIO-2: client GUC override is ignored for usr_<hex> sessions.
        """
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute(f"SET app.tenant_id = '{tenant_b.id}'")
            count = conn.execute("SELECT COUNT(*) FROM popups").fetchone()[0]

        # Count must reflect tenant A's popups, not tenant B's
        with psycopg.connect(dsn, autocommit=True) as conn:
            expected = conn.execute("SELECT COUNT(*) FROM popups").fetchone()[0]

        assert count == expected

    def test_set_role_does_not_change_effective_tenant(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """SET ROLE tenant_viewer_role must not expand or change the visible set.

        Covers SCENARIO-3: session_user remains usr_<hex> after SET ROLE.
        """
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn, autocommit=True) as conn:
            baseline = conn.execute("SELECT COUNT(*) FROM popups").fetchone()[0]
            conn.execute("SET ROLE tenant_viewer_role")
            after_role = conn.execute("SELECT COUNT(*) FROM popups").fetchone()[0]

        assert after_role == baseline
        # Tenant B popup must not leak in
        with psycopg.connect(dsn, autocommit=True) as conn:
            ids = [
                row[0]
                for row in conn.execute("SELECT id::text FROM popups").fetchall()
            ]
        assert str(popup_tenant_b.id) not in ids
        assert str(popup_tenant_a.id) in ids

    def test_tenants_table_scoped_to_own_row(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """A tenant readonly user must see exactly one row in the tenants table.

        Covers SCENARIO-4 and REQ-3.
        """
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn, autocommit=True) as conn:
            rows = conn.execute("SELECT id::text FROM tenants").fetchall()

        assert len(rows) == 1
        assert rows[0][0] == str(tenant_a.id)

    def test_owner_still_sees_all_tenants(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """The PostgreSQL table owner bypasses RLS and sees all tenants.

        Covers SCENARIO-7 and REQ-4. FORCE RLS must NOT be set on tenants.
        """
        host = postgres_container.get_container_host_ip()
        port = int(postgres_container.get_exposed_port(5432))
        owner_dsn = (
            f"host={host} port={port} dbname=test_db "
            f"user=test_user password=test_password sslmode=disable"
        )
        with psycopg.connect(owner_dsn, autocommit=True) as conn:
            count = conn.execute("SELECT COUNT(*) FROM tenants").fetchone()[0]

        # At minimum both tenant_a and tenant_b exist
        assert count >= 2

    def test_insert_for_other_tenant_rejected(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """An INSERT specifying tenant B's id must be blocked by WITH CHECK.

        Covers SCENARIO-5 and REQ-2.
        """
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.CRUD
        )
        with psycopg.connect(dsn) as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(
                    "INSERT INTO popups (id, name, slug, tenant_id) "
                    "VALUES (%s, %s, %s, %s)",
                    (
                        str(uuid.uuid4()),
                        "Cross-tenant popup",
                        f"cross-tenant-{uuid.uuid4().hex[:6]}",
                        str(tenant_b.id),
                    ),
                )
                conn.commit()

    def test_function_exists_and_returns_null_for_owner(
        self,
        db: Session,
    ) -> None:
        """app_effective_tenant_id() must exist and return NULL for the owner session.

        The owner has no row in tenant_credentials and sets no GUC, so
        the function should return NULL (both COALESCE branches are NULL).
        """
        from sqlalchemy import text

        result = db.exec(  # type: ignore[call-overload]
            text("SELECT public.app_effective_tenant_id()")
        ).scalar()
        assert result is None

    def test_duplicate_db_username_rejected(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Inserting a duplicate db_username into tenant_credentials must fail.

        Covers SCENARIO-8 and REQ-7.
        """
        import sqlalchemy.exc

        cred = db.exec(
            select(TenantCredentials).where(
                TenantCredentials.tenant_id == tenant_a.id,
                TenantCredentials.credential_type == CredentialType.READONLY,
            )
        ).first()
        assert cred is not None

        dup = TenantCredentials(
            tenant_id=tenant_a.id,
            credential_type=CredentialType.CRUD,
            db_username=cred.db_username,  # intentional duplicate
            db_password_encrypted="dummy",
        )
        db.add(dup)
        with pytest.raises(sqlalchemy.exc.IntegrityError):
            db.flush()
        db.rollback()

    def test_backend_tenant_session_unaffected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
    ) -> None:
        """The backend TenantSession must continue to return only tenant A's data.

        Covers SCENARIO-6 and REQ-5. Regression guard.
        """
        response = client.get(
            "/api/v1/popups",
            params={"search": "Popup Tenant"},
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )
        assert response.status_code == 200
        ids = [p["id"] for p in response.json()["results"]]
        assert str(popup_tenant_a.id) in ids
        assert str(popup_tenant_b.id) not in ids
