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
from tests._flow_helpers import default_flow_id
from tests.conftest import with_origin

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup(
    db: Session,
    tenant: Tenants,
    *,
    status: str = "active",
    slug_prefix: str = "boot",
    currency: str = "USD",
) -> Popups:
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Direct Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status=status,
        currency=currency,
    )
    db.add(popup)
    db.flush()
    # sdd/sales-flows slice 9: the runtime endpoint now resolves a flow
    # (default when none is given in the URL) — provision one directly,
    # mirroring task 5.0's real PopupsCRUD.create provisioning, since this
    # helper bypasses that CRUD.
    from app.api.sales_flow.crud import sales_flows_crud

    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.direct.value
    )
    db.flush()
    return popup


def _make_product(
    db: Session,
    popup: Popups,
    *,
    is_active: bool = True,
    name: str = "General Admission",
    price: str = "100.00",
    sold_out_override: bool = False,
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
        sold_out_override=sold_out_override,
    )
    db.add(product)
    db.flush()
    return product


def _make_form_section(
    db: Session,
    popup: Popups,
    *,
    order: int = 0,
    label: str = "Buyer Info",
    hidden: bool = False,
    sales_flow_id=None,
) -> FormSections:
    section = FormSections(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id or default_flow_id(db, popup.id),
        label=label,
        order=order,
        hidden=hidden,
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
    sales_flow_id=None,
) -> FormFields:
    field = FormFields(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id or default_flow_id(db, popup.id),
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
    product_category: str | None = "ticket",
    sales_flow_id: uuid.UUID | None = None,
) -> TicketingSteps:
    # Every step belongs to a flow (slice 2). Unless a test is specifically
    # about a second flow, that flow is the popup's default one.
    if sales_flow_id is None:
        from app.api.sales_flow.crud import sales_flows_crud

        sales_flow_id = sales_flows_crud.get_default_flow(db, popup.id).id

    step = TicketingSteps(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        step_type=step_type,
        product_category=product_category,
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


def test_runtime_valid_direct_popup(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Valid active direct popup returns 200 with correct shape."""
    popup = _make_direct_popup(db, tenant_a)
    _make_product(db, popup, name="GA Ticket")
    section = _make_form_section(db, popup)
    _make_form_field(db, popup, section)
    _make_ticketing_step(db, popup, step_type="tickets", title="Choose Tickets")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

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
    assert "attendee_categories" in body


def test_runtime_includes_attendee_categories(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Attendee categories ship in the public runtime so anonymous checkout
    never calls the human-gated portal endpoint."""
    from app.api.attendee_category.models import AttendeeCategories

    popup = _make_direct_popup(db, tenant_a)
    db.add(
        AttendeeCategories(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            key="main",
            is_primary=True,
            sort_order=0,
        )
    )
    db.add(
        AttendeeCategories(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            key="spouse",
            sort_order=1,
            display_meta={"label": "Spouse"},
        )
    )
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    categories = response.json()["attendee_categories"]
    assert [c["key"] for c in categories] == ["main", "spouse"]
    assert categories[1]["display_meta"] == {"label": "Spouse"}


def test_runtime_products_use_popup_currency(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Runtime products inherit the popup currency."""
    popup = _make_direct_popup(db, tenant_a, currency="ARS")
    _make_ticketing_step(db, popup)
    _make_product(db, popup, name="ARS Ticket")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["popup"]["currency"] == "ARS"
    assert body["products"][0]["currency"] == "ARS"


def test_runtime_only_enabled_ticketing_steps(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Only enabled ticketing steps are included in the public bootstrap."""
    popup = _make_direct_popup(db, tenant_a)
    _make_ticketing_step(
        db, popup, step_type="tickets", title="Visible Step", is_enabled=True
    )
    _make_ticketing_step(
        db, popup, step_type="merch", title="Hidden Step", is_enabled=False, order=1
    )
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [step["title"] for step in body["ticketing_steps"]] == ["Visible Step"]


def test_runtime_returns_only_the_resolved_flows_steps(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Without a flow slug the runtime resolves the popup's default flow and
    returns exactly its steps (sdd/sales-flows-rediseno slice 2). Another
    flow's list must never appear."""
    from app.api.sales_flow.crud import sales_flows_crud
    from app.api.sales_flow.models import SalesFlows

    popup = _make_direct_popup(db, tenant_a)
    default_flow = sales_flows_crud.get_default_flow(db, popup.id)
    flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        type="direct",
        slug="a-flow-owned-step",
        name="Flow",
    )
    db.add(flow)
    db.flush()

    _make_ticketing_step(
        db,
        popup,
        step_type="tickets",
        title="Default Flow Step",
        sales_flow_id=default_flow.id,
    )
    _make_ticketing_step(
        db,
        popup,
        step_type="buyer",
        title="Flow-Owned Step",
        order=1,
        sales_flow_id=flow.id,
    )
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [step["title"] for step in body["ticketing_steps"]] == [
        "Default Flow Step"
    ], "Another flow's steps must never leak into the resolved flow's runtime"


def test_runtime_excludes_hidden_sections_and_their_fields(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Hidden sections and their fields never reach the anonymous checkout,
    in buyer_form or in form_schema."""
    popup = _make_direct_popup(db, tenant_a)
    visible = _make_form_section(db, popup, label="Visible Info")
    _make_form_field(db, popup, visible, name="visible_field", label="Visible")
    hidden = _make_form_section(db, popup, label="Secret Info", order=1, hidden=True)
    hidden_field = _make_form_field(
        db, popup, hidden, name="secret_field", label="Secret"
    )
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()

    section_labels = [sec["label"] for sec in body["buyer_form"]]
    assert section_labels == ["Visible Info"]
    field_names = [f["name"] for sec in body["buyer_form"] for f in sec["form_fields"]]
    assert hidden_field.name not in field_names

    schema = body["form_schema"]
    assert hidden_field.name not in schema["custom_fields"]
    assert str(hidden.id) not in [sec["id"] for sec in schema["sections"]]


def test_purchase_validation_ignores_required_fields_in_hidden_sections(
    db: Session, tenant_a: Tenants
) -> None:
    """The purchase-side required check mirrors the bootstrap: fields in
    hidden sections are never asked, so they can't block a buyer."""
    from fastapi import HTTPException

    from app.api.payment.crud import payments_crud

    popup = _make_direct_popup(db, tenant_a)
    hidden = _make_form_section(db, popup, label="Hidden", hidden=True)
    _make_form_field(db, popup, hidden, name="hidden_req", label="Hidden Req")
    visible = _make_form_section(db, popup, label="Visible", order=1)
    visible_field = _make_form_field(
        db, popup, visible, name="visible_req", label="Visible Req"
    )
    db.commit()
    db.refresh(popup)

    # Hidden required field missing → accepted.
    payments_crud._validate_open_ticketing_form_data(popup, {visible_field.name: "ok"})

    # Visible required field missing → still rejected.
    with pytest.raises(HTTPException) as exc_info:
        payments_crud._validate_open_ticketing_form_data(popup, {})
    assert exc_info.value.status_code == 422


def test_runtime_unknown_slug_returns_404(
    client: TestClient, tenant_a: Tenants
) -> None:
    """Unknown popup slug returns 404."""
    response = client.get(
        "/api/v1/checkout/does-not-exist-xyz/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 404, response.text


def test_runtime_application_popup_asks_an_anonymous_caller_to_sign_in(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """An application flow is served, but only to the people it accepted.

    It used to be refused by type. That asked the wrong question: what
    separates an anonymous purchase from an application-backed one is who
    is buying (sdd/sales-flows-rediseno). 401 rather than 403 because no
    credentials were presented at all — the same signal an upsale flow
    gives.
    """
    from app.api.sales_flow.crud import sales_flows_crud

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
    db.flush()
    sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sale_type=SaleType.application.value,
    )
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 401, response.text


def test_runtime_inactive_direct_popup_returns_403(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Inactive direct popup returns 403."""
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    assert response.status_code == 403, response.text


def test_runtime_only_active_products(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Only active products are included in the response."""
    popup = _make_direct_popup(db, tenant_a)
    _make_ticketing_step(db, popup)
    _make_product(db, popup, name="Active GA", is_active=True)
    _make_product(db, popup, name="Inactive VIP", is_active=False)
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    product_names = [p["name"] for p in body["products"]]
    assert "Active GA" in product_names
    assert "Inactive VIP" not in product_names


def test_runtime_exposes_sold_out_override(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Products carry sold_out_override so the portal can hide manually
    sold-out products instead of deriving on_sale as available."""
    popup = _make_direct_popup(db, tenant_a)
    _make_ticketing_step(db, popup)
    _make_product(db, popup, name="Sold Out GA", sold_out_override=True)
    _make_product(db, popup, name="Available VIP")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    products = {p["name"]: p for p in response.json()["products"]}
    assert products["Sold Out GA"]["sold_out_override"] is True
    assert products["Available VIP"]["sold_out_override"] is False


def test_runtime_rate_limit_triggers_429(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """121st request from same IP returns 429 (mocked Redis at limit)."""
    popup = _make_direct_popup(db, tenant_a)
    db.commit()

    mock_redis = __import__("unittest.mock", fromlist=["MagicMock"]).MagicMock()
    mock_redis.get.return_value = "120"  # at limit
    mock_redis.ttl.return_value = 45

    with patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        response = client.get(
            f"/api/v1/checkout/{popup.slug}/runtime",
            headers={"X-Forwarded-For": "8.8.8.8", "X-Tenant-Id": str(tenant_a.id)},
        )

    assert response.status_code == 429, response.text
    assert "Retry-After" in response.headers


# ---------------------------------------------------------------------------
# Phase 3 — Tenant-scoped runtime tests (T-3.1)
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("popup_tenant_b_summer_fest")
def test_runtime_resolves_per_tenant_slug_collision(
    client: TestClient,
    popup_tenant_a_summer_fest: Popups,
) -> None:
    """Slug collision: origin resolves to tenant A → tenant A's popup returned."""
    response = client.get(
        "/api/v1/checkout/summer-fest/runtime",
        headers=with_origin("test-tenant-a.localhost"),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["popup"]["id"] == str(popup_tenant_a_summer_fest.id)


@pytest.mark.usefixtures("tenant_a")
def test_runtime_cross_tenant_slug_returns_404(
    client: TestClient,
    db: Session,
    popup_tenant_b_summer_fest: Popups,
) -> None:
    """Slug exists under tenant B but not A; origin resolves to A → 404."""
    # This test relies on a slug that tenant_a does NOT have.
    # We use a unique slug so it only exists under tenant_b.
    import uuid as _uuid

    unique_slug = f"only-b-{_uuid.uuid4().hex[:8]}"
    from app.api.popup.models import Popups as _Popups
    from app.api.shared.enums import SaleType as _SaleType

    tenant_b_only = _Popups(
        id=_uuid.uuid4(),
        tenant_id=popup_tenant_b_summer_fest.tenant_id,
        name="Only B Popup",
        slug=unique_slug,
        sale_type=_SaleType.direct.value,
        status="active",
    )
    db.add(tenant_b_only)
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{unique_slug}/runtime",
        headers=with_origin("test-tenant-a.localhost"),
    )

    assert response.status_code == 404, response.text


def test_runtime_unknown_origin_returns_404(
    client: TestClient,
) -> None:
    """No Origin header and no X-Tenant-Id → 404 from resolver."""
    response = client.get("/api/v1/checkout/summer-fest/runtime")
    assert response.status_code == 404, response.text


def test_runtime_x_tenant_id_fallback(
    client: TestClient,
    popup_tenant_a_summer_fest: Popups,
    tenant_a: Tenants,
) -> None:
    """No Origin header, X-Tenant-Id present → returns correct popup."""
    response = client.get(
        "/api/v1/checkout/summer-fest/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["popup"]["id"] == str(popup_tenant_a_summer_fest.id)
