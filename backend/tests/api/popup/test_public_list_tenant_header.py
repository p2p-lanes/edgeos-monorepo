"""Public popup lists reject malformed tenant headers instead of returning 500."""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup import crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants

URL = "/api/v1/popups/public/list"


@pytest.mark.parametrize(
    "tenant_header",
    [None, "", "undefined", "null", "edge-india", "not-a-uuid"],
    ids=["missing", "empty", "undefined", "null", "slug", "malformed"],
)
def test_invalid_tenant_header_returns_422_without_querying_popups(
    client: TestClient, tenant_header: str | None
) -> None:
    headers = {} if tenant_header is None else {"X-Tenant-Id": tenant_header}

    with patch.object(crud, "find") as find:
        response = client.get(URL, headers=headers)
        find.assert_not_called()

    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["header", "X-Tenant-Id"]


def test_valid_tenant_header_preserves_tenant_isolation(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    tenant_b: Tenants,
) -> None:
    popups = [
        Popups(
            name="Public list header test",
            slug=f"public-header-{uuid.uuid4().hex}",
            tenant_id=tenant.id,
            status=PopupStatus.active,
        )
        for tenant in (tenant_a, tenant_b)
    ]
    db.add_all(popups)
    db.commit()

    for tenant, own_popup, other_popup in (
        (tenant_a, popups[0], popups[1]),
        (tenant_b, popups[1], popups[0]),
    ):
        response = client.get(URL, headers={"X-Tenant-Id": str(tenant.id)})

        assert response.status_code == 200, response.text
        popup_ids = {popup["id"] for popup in response.json()}
        assert str(own_popup.id) in popup_ids
        assert str(other_popup.id) not in popup_ids


def test_tenant_header_is_documented_as_required_uuid(client: TestClient) -> None:
    response = client.get("/openapi.json")
    assert response.status_code == 200, response.text
    parameters = response.json()["paths"][URL]["get"]["parameters"]
    tenant_header = next(p for p in parameters if p["name"] == "X-Tenant-Id")

    assert tenant_header["in"] == "header"
    assert tenant_header["required"] is True
    assert tenant_header["schema"]["type"] == "string"
    assert tenant_header["schema"]["format"] == "uuid"
