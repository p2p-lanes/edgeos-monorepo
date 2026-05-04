"""Tests for GET /checkout/{slug}/runtime — CAP-A.

TDD: RED → GREEN.

Scenarios:
1. Valid active direct popup returns 200 with {popup, products, buyer_form, ticketing_steps} shape
2. Unknown slug returns 404
3. Application popup returns 403
4. Inactive direct popup returns 403
5. Only active products included in products[]
6. Rate limit 121st request returns 429 (mocked Redis)
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup(
    db: Session,
    tenant: Tenants,
    *,
    status: str = "active",
    slug_prefix: str = "boot",
) -> Popups:
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Direct Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status=status,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_product(
    db: Session,
    popup: Popups,
    *,
    is_active: bool = True,
    name: str = "General Admission",
    price: str = "100.00",
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=price,
        is_active=is_active,
        category="ticket",
    )
    db.add(product)
    db.flush()
    return product


def _make_form_section(db: Session, popup: Popups, *, order: int = 0, label: str = "Buyer Info") -> FormSections:
    section = FormSections(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        label=label,
        order=order,
    )
    db.add(section)
    db.flush()
    return section


def _make_form_field(
    db: Session,
    popup: Popups,
    section: FormSections,
    *,
    name: str = "first_name",
    label: str = "Nombre",
    required: bool = True,
) -> FormFields:
    field = FormFields(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        section_id=section.id,
        name=f"{name}_{uuid.uuid4().hex[:4]}",
        label=label,
        field_type="text",
        required=required,
        position=0,
    )
    db.add(field)
    db.flush()
    return field


def _make_ticketing_step(
    db: Session,
    popup: Popups,
    *,
    step_type: str = "tickets",
    title: str = "Select Tickets",
    order: int = 0,
    is_enabled: bool = True,
) -> TicketingSteps:
    step = TicketingSteps(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        step_type=step_type,
        title=title,
        order=order,
        is_enabled=is_enabled,
    )
    db.add(step)
    db.flush()
    return step


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_runtime_valid_direct_popup(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """Valid active direct popup returns 200 with correct shape."""
    popup = _make_direct_popup(db, tenant_a)
    _make_product(db, popup, name="GA Ticket")
    section = _make_form_section(db, popup)
    _make_form_field(db, popup, section)
    _make_ticketing_step(db, popup, step_type="tickets", title="Choose Tickets")
    db.commit()

    response = client.get(f"/api/v1/checkout/{popup.slug}/runtime")

    assert response.status_code == 200, response.text
    body = response.json()

    assert "popup" in body
    assert "products" in body
    assert "buyer_form" in body
    assert "ticketing_steps" in body

    assert body["popup"]["slug"] == popup.slug
    assert body["popup"]["sale_type"] == "direct"
    assert "checkout_mode" in body["popup"]

    assert len(body["products"]) == 1
    assert body["products"][0]["name"] == "GA Ticket"

    assert len(body["buyer_form"]) == 1
    assert len(body["buyer_form"][0]["form_fields"]) == 1
    assert len(body["ticketing_steps"]) == 1
    assert body["ticketing_steps"][0]["step_type"] == "tickets"
    assert body["ticketing_steps"][0]["title"] == "Choose Tickets"


def test_runtime_only_enabled_ticketing_steps(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """Only enabled ticketing steps are included in the public bootstrap."""
    popup = _make_direct_popup(db, tenant_a)
    _make_ticketing_step(db, popup, step_type="tickets", title="Visible Step", is_enabled=True)
    _make_ticketing_step(db, popup, step_type="merch", title="Hidden Step", is_enabled=False, order=1)
    db.commit()

    response = client.get(f"/api/v1/checkout/{popup.slug}/runtime")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [step["title"] for step in body["ticketing_steps"]] == ["Visible Step"]


def test_runtime_unknown_slug_returns_404(client: TestClient) -> None:
    """Unknown popup slug returns 404."""
    response = client.get("/api/v1/checkout/does-not-exist-xyz/runtime")
    assert response.status_code == 404, response.text


def test_runtime_application_popup_returns_403(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """Application popup returns 403 (only direct-sale popups served)."""
    slug = f"app-boot-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        name=f"App Popup {slug}",
        slug=slug,
        sale_type=SaleType.application.value,
        status="active",
    )
    db.add(popup)
    db.commit()

    response = client.get(f"/api/v1/checkout/{popup.slug}/runtime")
    assert response.status_code == 403, response.text


def test_runtime_inactive_direct_popup_returns_403(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """Inactive direct popup returns 403."""
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.get(f"/api/v1/checkout/{popup.slug}/runtime")
    assert response.status_code == 403, response.text


def test_runtime_only_active_products(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """Only active products are included in the response."""
    popup = _make_direct_popup(db, tenant_a)
    _make_product(db, popup, name="Active GA", is_active=True)
    _make_product(db, popup, name="Inactive VIP", is_active=False)
    db.commit()

    response = client.get(f"/api/v1/checkout/{popup.slug}/runtime")

    assert response.status_code == 200, response.text
    body = response.json()
    product_names = [p["name"] for p in body["products"]]
    assert "Active GA" in product_names
    assert "Inactive VIP" not in product_names


def test_runtime_rate_limit_triggers_429(client: TestClient, db: Session, tenant_a: Tenants) -> None:
    """121st request from same IP returns 429 (mocked Redis at limit)."""
    popup = _make_direct_popup(db, tenant_a)
    db.commit()

    mock_redis = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    mock_redis.get.return_value = "120"  # at limit
    mock_redis.ttl.return_value = 45

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        response = client.get(
            f"/api/v1/checkout/{popup.slug}/runtime",
            headers={"X-Forwarded-For": "8.8.8.8"},
        )

    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers
