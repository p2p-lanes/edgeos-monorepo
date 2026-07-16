import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from app.services.email.service import EmailService
from app.utils.encryption import decrypt


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_can_configure_own_tenant_smtp(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    response = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        headers=_headers(admin_token_tenant_a),
        json={
            "smtp_host": "smtp.tenant-a.test",
            "smtp_port": 1025,
            "smtp_user": "tenant-a-user",
            "smtp_password": "tenant-a-pass",
            "smtp_tls": False,
            "smtp_ssl": False,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["smtp_host"] == "smtp.tenant-a.test"
    assert body["smtp_port"] == 1025
    assert body["smtp_user"] == "tenant-a-user"
    assert body["smtp_configured"] is True
    assert body["smtp_password_configured"] is True
    assert "smtp_password" not in body
    assert "smtp_password_encrypted" not in body

    db.refresh(tenant_a)
    assert tenant_a.smtp_password_encrypted != "tenant-a-pass"
    assert decrypt(tenant_a.smtp_password_encrypted) == "tenant-a-pass"


def test_admin_cannot_configure_other_tenant_smtp(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_b: Tenants,
) -> None:
    response = client.patch(
        f"/api/v1/tenants/{tenant_b.id}",
        headers=_headers(admin_token_tenant_a),
        json={"smtp_host": "smtp.other.test"},
    )

    assert response.status_code == 403, response.text


def test_public_tenant_response_does_not_expose_smtp_fields(
    client: TestClient,
    db: Session,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    tenant = Tenants(
        name=f"SMTP Public {suffix}",
        slug=f"smtp-public-{suffix}",
        smtp_host="smtp.private.test",
        smtp_user="private-user",
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    response = client.get(f"/api/v1/tenants/public/{tenant.slug}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert "smtp_host" not in body
    assert "smtp_user" not in body
    assert "smtp_password_configured" not in body


def test_rejects_smtp_host_with_scheme_path_or_port(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    for smtp_host in ["http://mailpit:1025", "mailpit:1025", "mailpit/path"]:
        response = client.patch(
            f"/api/v1/tenants/{tenant_a.id}",
            headers=_headers(admin_token_tenant_a),
            json={"smtp_host": smtp_host},
        )

        assert response.status_code == 422, response.text


def test_smtp_host_is_trimmed(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    response = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        headers=_headers(admin_token_tenant_a),
        json={"smtp_host": " mailpit ", "smtp_port": 1025},
    )

    assert response.status_code == 200, response.text
    assert response.json()["smtp_host"] == "mailpit"


def test_clearing_smtp_config_clears_encrypted_password(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    tenant_a.smtp_host = "smtp.to-clear.test"
    tenant_a.smtp_port = 1025
    tenant_a.smtp_user = "clear-user"
    tenant_a.smtp_password_encrypted = "will-be-overwritten"
    db.add(tenant_a)
    db.commit()

    response = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        headers=_headers(admin_token_tenant_a),
        json={
            "smtp_host": None,
            "smtp_user": None,
            "smtp_password": None,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["smtp_configured"] is False
    assert body["smtp_password_configured"] is False

    db.refresh(tenant_a)
    assert tenant_a.smtp_host is None
    assert tenant_a.smtp_user is None
    assert tenant_a.smtp_password_encrypted is None


def test_admin_can_send_smtp_test_email_for_own_tenant(
    client: TestClient,
    monkeypatch,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    captured: dict[str, object] = {}

    async def fake_send_email(_self, **kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    response = client.post(
        f"/api/v1/tenants/{tenant_a.id}/smtp-test",
        headers=_headers(admin_token_tenant_a),
        json={"to_email": "smtp-test@test.com"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["message"] == "Test email sent to smtp-test@test.com"
    assert captured["to"] == "smtp-test@test.com"
    assert captured["tenant_id"] == tenant_a.id
    assert captured["db_session"] is not None


def test_admin_cannot_send_smtp_test_email_for_other_tenant(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_b: Tenants,
) -> None:
    response = client.post(
        f"/api/v1/tenants/{tenant_b.id}/smtp-test",
        headers=_headers(admin_token_tenant_a),
        json={"to_email": "smtp-test@test.com"},
    )

    assert response.status_code == 403, response.text
