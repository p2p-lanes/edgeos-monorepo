from importlib import import_module
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from app.api.shared.enums import CredentialType, UserRole
from app.core.config import settings
from app.core.dependencies.users import get_admin, get_session

tenant_router = import_module("app.api.tenant.router")


def test_public_database_endpoint_does_not_change_internal_connection(
    monkeypatch: MonkeyPatch,
) -> None:
    tenant_id = uuid4()
    app = FastAPI()
    app.include_router(tenant_router.router)
    app.dependency_overrides[get_session] = lambda: object()
    actor = SimpleNamespace(role=UserRole.ADMIN, tenant_id=tenant_id)
    app.dependency_overrides[get_admin] = lambda: actor
    monkeypatch.setattr(settings, "POSTGRES_SERVER", "private-db")
    monkeypatch.setattr(settings, "POSTGRES_PORT", 5544)
    monkeypatch.setattr(settings, "POSTGRES_DB", "edgeos")
    monkeypatch.setitem(vars(settings), "TENANT_DB_PUBLIC_HOST", None)
    monkeypatch.setattr(
        tenant_router,
        "get_tenant_credential",
        lambda _db, _tenant_id, kind: (f"tenant_{kind.value}", "test-password"),
    )
    internal_uri = str(settings.SQLALCHEMY_DATABASE_URI)
    credentials = [
        {
            "credential_type": CredentialType.READONLY.value,
            "db_username": "tenant_readonly",
            "db_password": "test-password",
        }
    ]
    with TestClient(app) as client:
        legacy = client.get(f"/tenants/{tenant_id}/credentials")
        assert legacy.status_code == 200
        assert legacy.json() == {
            "db_host": "private-db",
            "db_port": 5544,
            "db_name": "edgeos",
            "credentials": credentials,
        }
        monkeypatch.setitem(vars(settings), "TENANT_DB_PUBLIC_HOST", "db.edgeos.world")
        public = client.get(f"/tenants/{tenant_id}/credentials")
        assert client.get(f"/tenants/{uuid4()}/credentials").status_code == 403
        actor.role = UserRole.SUPERADMIN
        elevated = client.get(f"/tenants/{tenant_id}/credentials")
    assert public.status_code == 200
    assert public.json() == {
        "db_host": "db.edgeos.world",
        "db_port": 5432,
        "db_name": "edgeos",
        "db_ssl_mode": "verify-full",
        "credentials": credentials,
    }
    assert elevated.status_code == 200
    assert {item["credential_type"] for item in elevated.json()["credentials"]} == {
        CredentialType.READONLY.value,
        CredentialType.CRUD.value,
    }
    assert str(settings.SQLALCHEMY_DATABASE_URI) == internal_uri
