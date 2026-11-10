"""GA4 Measurement Protocol credentials are private tenant configuration."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants
from app.api.tenant.schemas import TenantAnonymousPublic, TenantPublic
from app.utils.encryption import decrypt


def test_ga_api_secret_is_encrypted_and_not_returned(
    client: TestClient,
    db: Session,
    superadmin_token: str,
    tenant_a: Tenants,
) -> None:
    response = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"ga_mp_api_secret": "test-ga-secret"},
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )

    assert response.status_code == 200, response.text
    db.refresh(tenant_a)
    assert tenant_a.ga_mp_api_secret_encrypted != "test-ga-secret"
    assert decrypt(tenant_a.ga_mp_api_secret_encrypted) == "test-ga-secret"
    assert response.json()["ga_mp_configured"] is True
    assert "ga_mp_api_secret" not in response.json()
    assert "ga_mp_api_secret_encrypted" not in response.json()
    assert (
        "ga_mp_configured"
        not in TenantAnonymousPublic.model_validate(tenant_a).model_dump()
    )

    unchanged = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"ga_measurement_id": "G-TEST123"},
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )
    assert unchanged.status_code == 200, unchanged.text
    db.refresh(tenant_a)
    assert decrypt(tenant_a.ga_mp_api_secret_encrypted) == "test-ga-secret"


def test_ga_api_secret_can_be_removed(
    client: TestClient,
    db: Session,
    superadmin_token: str,
    tenant_a: Tenants,
) -> None:
    tenant_a.ga_mp_api_secret_encrypted = "encrypted-placeholder"
    db.add(tenant_a)
    db.commit()

    response = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"ga_mp_api_secret": None},
        headers={"Authorization": f"Bearer {superadmin_token}"},
    )

    assert response.status_code == 200, response.text
    db.refresh(tenant_a)
    assert tenant_a.ga_mp_api_secret_encrypted is None
    assert response.json()["ga_mp_configured"] is False
    assert "ga_mp_api_secret" not in TenantPublic.model_validate(tenant_a).model_dump()
