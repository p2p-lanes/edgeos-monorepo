"""Tests for product insurance eligibility field (POPUP-2).

Scenarios:
  - insurance_eligible persisted as true when sent
  - insurance_eligible persisted as false when sent
  - insurance_eligible defaults to false when omitted
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.product.models import Products


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_product(
    client: TestClient,
    admin_token_tenant_a: str,
    popup_id: str,
    *,
    insurance_eligible: bool | None = None,
    extra: dict | None = None,
) -> dict:
    payload: dict = {
        "popup_id": popup_id,
        "name": f"Product {uuid.uuid4().hex[:8]}",
        "price": "50.00",
        "category": "ticket",
    }
    if insurance_eligible is not None:
        payload["insurance_eligible"] = insurance_eligible
    if extra:
        payload.update(extra)

    response = client.post(
        "/api/v1/products",
        headers=_admin_headers(admin_token_tenant_a),
        json=payload,
    )
    assert response.status_code in (200, 201), response.text
    return response.json()


class TestProductInsuranceEligibility:
    def test_create_product_with_insurance_eligible_true(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
        db: Session,
    ) -> None:
        """POPUP-2: product created with insurance_eligible=true is persisted."""
        data = _create_product(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            insurance_eligible=True,
        )
        assert data["insurance_eligible"] is True

        db.expire_all()
        product = db.get(Products, uuid.UUID(data["id"]))
        assert product is not None
        assert product.insurance_eligible is True

    def test_create_product_with_insurance_eligible_false(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
        db: Session,
    ) -> None:
        """POPUP-2: product created with insurance_eligible=false is persisted."""
        data = _create_product(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            insurance_eligible=False,
        )
        assert data["insurance_eligible"] is False

        db.expire_all()
        product = db.get(Products, uuid.UUID(data["id"]))
        assert product is not None
        assert product.insurance_eligible is False

    def test_create_product_defaults_insurance_eligible_to_false(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a,
        db: Session,
    ) -> None:
        """POPUP-2: omitting insurance_eligible defaults to false."""
        data = _create_product(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            # intentionally no insurance_eligible
        )
        assert data["insurance_eligible"] is False

        db.expire_all()
        product = db.get(Products, uuid.UUID(data["id"]))
        assert product is not None
        assert product.insurance_eligible is False
