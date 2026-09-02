"""Tests verifying that insurance_percentage is no longer accepted/returned via API (B.1).

POPUP-B1: The API must:
  - Reject insurance_percentage on CREATE
  - Reject insurance_percentage on UPDATE
  - Not return insurance_percentage in ProductPublic responses
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestInsurancePercentageRemovedFromApi:
    def test_create_product_rejects_insurance_percentage_in_payload(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
        db: Session,
    ) -> None:
        """B.1: removed product fields are rejected by the strict write schema."""
        response = client.post(
            "/api/v1/products",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "name": f"Pct Test {uuid.uuid4().hex[:8]}",
                "price": "50.00",
                "category": "ticket",
                "insurance_percentage": "5.00",
            },
        )
        assert response.status_code == 422, response.text
        assert response.json()["detail"][0]["type"] == "extra_forbidden"

    def test_update_product_rejects_insurance_percentage_in_payload(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
        db: Session,
    ) -> None:
        """B.1: removed product fields are rejected by the strict patch schema."""
        # First create a product
        create_resp = client.post(
            "/api/v1/products",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "name": f"Pct Update {uuid.uuid4().hex[:8]}",
                "price": "30.00",
                "category": "ticket",
            },
        )
        assert create_resp.status_code in (200, 201)
        product_id = create_resp.json()["id"]

        update_resp = client.patch(
            f"/api/v1/products/{product_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"insurance_percentage": "7.00"},
        )
        assert update_resp.status_code == 422, update_resp.text
        assert update_resp.json()["detail"][0]["type"] == "extra_forbidden"

    def test_create_product_response_does_not_include_insurance_percentage(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
    ) -> None:
        """B.1: ProductPublic response must not expose insurance_percentage field."""
        response = client.post(
            "/api/v1/products",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "name": f"NoExpose {uuid.uuid4().hex[:8]}",
                "price": "20.00",
                "category": "ticket",
            },
        )
        assert response.status_code in (200, 201)
        data = response.json()
        assert "insurance_percentage" not in data, (
            "insurance_percentage must not appear in API response"
        )
