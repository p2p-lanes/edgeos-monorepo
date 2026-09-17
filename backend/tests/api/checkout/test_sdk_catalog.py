"""The SDK's own catalogue and form endpoints, and the gates they relax.

An SDK client builds its own checkout: it renders no ticketing steps and
decides for itself who may buy. So a publishable-key call reads the popup's
whole active catalogue and buys from it, while the portal keeps every rule it
has today. Both halves are pinned here — the relaxation AND the fact that it
never leaks to a call without a key.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.accommodation.constants import PRODUCT_MANAGED_BY_ACCOMMODATION
from app.api.publishable_key import crud as pk_crud
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import default_flow_id
from tests.api.checkout.test_purchase import (
    _make_field,
    _make_popup,
    _make_product,
    _make_section,
)

ORIGIN = "https://checkout.acme.example"


@pytest.fixture(autouse=True)
def disable_rate_limit() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _key_headers(raw_key: str) -> dict:
    return {"X-EdgeOS-Publishable-Key": raw_key, "Origin": ORIGIN}


def _portal_headers(tenant: Tenants) -> dict:
    """How the portal reaches these routes: tenant by header, no key."""
    return {"X-Tenant-Id": str(tenant.id)}


def _mint_key(db: Session, tenant: Tenants) -> str:
    _, raw = pk_crud.create_publishable_key(
        db,
        tenant_id=tenant.id,
        name="external-checkout",
        allowed_origins=[ORIGIN],
    )
    db.commit()
    return raw


def _unoffered_product(db: Session, popup, **kwargs):
    """A product no step offers: its category is not sold by this flow."""
    product = _make_product(db, popup, name="Backstage", **kwargs)
    product.category = "backstage"
    db.add(product)
    db.commit()
    return product


def test_products_lists_what_no_step_offers(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-cat")
    offered = _make_product(db, popup, price="120.00")
    unoffered = _unoffered_product(db, popup, price="500.00")
    raw = _mint_key(db, tenant_a)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/products", headers=_key_headers(raw)
    )

    assert response.status_code == 200, response.text
    ids = {p["id"] for p in response.json()["products"]}
    assert {str(offered.id), str(unoffered.id)} <= ids
    # The flow-scoped runtime still hides it: that payload is the portal's.
    runtime = client.get(
        f"/api/v1/checkout/{popup.slug}/checkout/runtime", headers=_key_headers(raw)
    )
    assert runtime.status_code == 200, runtime.text
    assert str(unoffered.id) not in {p["id"] for p in runtime.json()["products"]}


def test_products_excludes_inactive_deleted_and_shadow(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-hidden")
    visible = _make_product(db, popup)
    inactive = _make_product(db, popup, name="Inactive")
    inactive.is_active = False
    room = _make_product(db, popup, name="Room")
    room.managed_by = PRODUCT_MANAGED_BY_ACCOMMODATION
    db.add(inactive)
    db.add(room)
    raw = _mint_key(db, tenant_a)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/products", headers=_key_headers(raw)
    )

    assert response.status_code == 200, response.text
    ids = {p["id"] for p in response.json()["products"]}
    assert ids == {str(visible.id)}


def test_products_and_form_require_a_publishable_key(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-nokey")
    _make_product(db, popup)
    db.commit()

    portal = _portal_headers(tenant_a)
    products = client.get(f"/api/v1/checkout/{popup.slug}/products", headers=portal)
    form = client.get(f"/api/v1/checkout/{popup.slug}/form", headers=portal)

    assert products.status_code == 401, products.text
    assert form.status_code == 401, form.text


def test_form_returns_the_primary_flow_schema(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-form")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    raw = _mint_key(db, tenant_a)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/form", headers=_key_headers(raw)
    )

    assert response.status_code == 200, response.text
    schema = response.json()["form_schema"]
    assert "base_fields" in schema
    assert field.name in schema["custom_fields"]


def test_a_missing_popup_is_a_404(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    raw = _mint_key(db, tenant_a)

    response = client.get(
        f"/api/v1/checkout/nope-{uuid.uuid4().hex[:6]}/products",
        headers=_key_headers(raw),
    )

    assert response.status_code == 404, response.text


def test_preview_prices_a_product_no_step_offers(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-prev")
    unoffered = _unoffered_product(db, popup, price="200.00")
    raw = _mint_key(db, tenant_a)
    body = {"products": [{"product_id": str(unoffered.id), "quantity": 1}]}

    with_key = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json=body,
        headers=_key_headers(raw),
    )
    without_key = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json=body,
        headers=_portal_headers(tenant_a),
    )

    assert with_key.status_code == 200, with_key.text
    assert with_key.json()["total"] == "200.00"
    # The portal is untouched: the product is still not in this flow.
    assert without_key.status_code == 403, without_key.text
    assert without_key.json()["detail"]["code"] == "product_not_in_flow"


def test_a_key_may_only_name_the_primary_flow(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    from app.api.sales_flow.models import SalesFlows

    popup = _make_popup(db, tenant_a, slug_prefix="sdk-second")
    product = _make_product(db, popup)
    secondary = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        type=SaleType.direct.value,
        slug="sponsors",
        name="Sponsors",
        is_default=False,
        order=1,
    )
    db.add(secondary)
    raw = _mint_key(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/sponsors/preview",
        json={"products": [{"product_id": str(product.id), "quantity": 1}]},
        headers=_key_headers(raw),
    )

    assert response.status_code == 403, response.text


def test_preview_still_refuses_a_disabled_product(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Relaxed gates are about WHO may buy, never about what is sellable."""
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-off")
    product = _make_product(db, popup)
    product.is_active = False
    db.add(product)
    raw = _mint_key(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json={"products": [{"product_id": str(product.id), "quantity": 1}]},
        headers=_key_headers(raw),
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "quote_unavailable"


def test_preview_still_refuses_a_shadow_product(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-shadow")
    room = _make_product(db, popup, name="Room")
    room.managed_by = PRODUCT_MANAGED_BY_ACCOMMODATION
    db.add(room)
    raw = _mint_key(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json={"products": [{"product_id": str(room.id), "quantity": 1}]},
        headers=_key_headers(raw),
    )

    assert response.status_code == 422, response.text


def test_an_application_popup_sells_to_a_key_but_not_to_the_portal(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """The primary flow of an application gathering is type `application`.

    The portal refuses an anonymous sale there (the buyer must be accepted);
    an SDK client carries its own gating, so the key is served.
    """
    popup = _make_popup(
        db, tenant_a, sale_type=SaleType.application.value, slug_prefix="sdk-app"
    )
    product = _make_product(db, popup, price="90.00")
    raw = _mint_key(db, tenant_a)
    flow_slug = client.get(
        f"/api/v1/checkout/{popup.slug}/primary", headers=_key_headers(raw)
    ).json()["flow_slug"]
    body = {"products": [{"product_id": str(product.id), "quantity": 1}]}

    with_key = client.post(
        f"/api/v1/checkout/{popup.slug}/{flow_slug}/preview",
        json=body,
        headers=_key_headers(raw),
    )
    without_key = client.post(
        f"/api/v1/checkout/{popup.slug}/{flow_slug}/preview",
        json=body,
        headers=_portal_headers(tenant_a),
    )

    assert with_key.status_code == 200, with_key.text
    assert with_key.json()["total"] == "90.00"
    assert without_key.status_code in (401, 403), without_key.text


def test_a_disabled_step_no_longer_hides_its_products_from_a_key(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-disabled")
    product = _make_product(db, popup, price="70.00")
    steps = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.sales_flow_id == default_flow_id(db, popup.id)
        )
    ).all()
    assert steps, "the fixture should have seeded steps"
    for step in steps:
        step.is_enabled = False
        db.add(step)
    db.commit()
    raw = _mint_key(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/preview",
        json={"products": [{"product_id": str(product.id), "quantity": 1}]},
        headers=_key_headers(raw),
    )

    assert response.status_code == 200, response.text


def test_purchase_buys_a_product_no_step_offers(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """The end the relaxation exists for: a real payment for a real product."""
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-buy")
    section = _make_section(db, popup)
    field = _make_field(db, popup, section)
    unoffered = _unoffered_product(db, popup, price="300.00")
    raw = _mint_key(db, tenant_a)
    body = {
        "products": [{"product_id": str(unoffered.id), "quantity": 1}],
        "buyer": {
            "email": "buyer@acme.example",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "form_data": {field.name: "Ada"},
        },
    }

    with patch("app.services.simplefi.get_simplefi_client") as mock_client:
        mock_client.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_sdk_catalog",
            status="pending",
            checkout_url="https://simplefi.test/checkout/sdk",
            is_installment_plan=False,
        )
        with_key = client.post(
            f"/api/v1/checkout/{popup.slug}/checkout/purchase",
            json=body,
            headers=_key_headers(raw),
        )
        without_key = client.post(
            f"/api/v1/checkout/{popup.slug}/checkout/purchase",
            json=body,
            headers=_portal_headers(tenant_a),
        )

    assert with_key.status_code == 200, with_key.text
    assert with_key.json()["amount"] == "300.00"
    # The portal still cannot buy what its steps never offered.
    assert without_key.status_code == 403, without_key.text
    assert without_key.json()["detail"]["code"] == "product_not_in_flow"


def test_purchase_of_a_ticket_still_needs_the_required_form_fields(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Money and data rules are the server's, gating is the client's."""
    popup = _make_popup(db, tenant_a, slug_prefix="sdk-required")
    section = _make_section(db, popup)
    _make_field(db, popup, section)
    product = _make_product(db, popup)
    raw = _mint_key(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/checkout/purchase",
        json={
            "products": [{"product_id": str(product.id), "quantity": 1}],
            "buyer": {
                "email": "buyer@acme.example",
                "first_name": "Ada",
                "last_name": "Lovelace",
                "form_data": {},
            },
        },
        headers=_key_headers(raw),
    )

    assert response.status_code == 422, response.text
