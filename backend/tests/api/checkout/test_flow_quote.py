from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.coupon.models import Coupons
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token
from tests.api.checkout.test_flow_scoped_runtime import _make_flow as _flow
from tests.api.checkout.test_purchase import _make_popup, _make_product
from tests.api.checkout.test_upsale_flow_gate import _make_human


def _offer(
    db: Session, popup: Popups, flow: SalesFlows, category: str = "ticket"
) -> None:
    db.add(
        TicketingSteps(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            step_type="tickets",
            product_category=category,
            title="Products",
        )
    )
    db.flush()


def _buyer(email: str = "quote@test.com", form_data: dict | None = None) -> dict:
    return {
        "email": email,
        "first_name": "Quote",
        "last_name": "Buyer",
        "form_data": form_data or {},
    }


def _preview(
    client: TestClient,
    popup: Popups,
    tenant: Tenants,
    product: Products,
    *,
    flow: SalesFlows | None = None,
    buyer: dict | None = None,
    quantity: int = 1,
    coupon_code: str | None = None,
    token: str | None = None,
):
    params = {"flow_slug": flow.slug} if flow else None
    headers = {"X-Tenant-Id": str(tenant.id)}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = {
        "products": [{"product_id": str(product.id), "quantity": quantity}],
        "coupon_code": coupon_code,
    }
    if buyer is not None:
        body["buyer"] = buyer
    return client.post(
        f"/api/v1/checkout/{popup.slug}/preview",
        params=params,
        headers=headers,
        json=body,
    )


def test_runtime_and_quote_keep_named_flow_over_compatible_default(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="named-quote")
    default_flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert default_flow is not None
    named = _flow(db, popup, slug="experiences")
    _offer(db, popup, named)
    product = _make_product(db, popup, price="100.00")
    db.commit()

    runtime = client.get(
        f"/api/v1/checkout/{popup.slug}/{named.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    quote = _preview(client, popup, tenant_a, product, flow=named, buyer=_buyer())

    assert runtime.json()["selected_flow"] == {
        "id": str(named.id),
        "slug": named.slug,
        "name": named.name,
        "type": "direct",
    }
    assert quote.json()["selected_flow"]["id"] == str(named.id)


def test_omitted_flow_uses_only_default_and_never_another_flow(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="no-default-quote")
    default_flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert default_flow is not None
    product = _make_product(db, popup)
    named = _flow(db, popup, slug="named-only")
    _offer(db, popup, named)
    db.commit()

    compatible = _preview(client, popup, tenant_a, product)
    assert compatible.json()["selected_flow"]["id"] == str(default_flow.id)

    default_flow.is_default = False
    db.add(default_flow)
    db.commit()
    omitted = _preview(client, popup, tenant_a, product)

    assert omitted.status_code == 404
    assert omitted.json()["detail"] == "Not found"


def test_complete_context_gets_definitive_quote_with_purchase_parity(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="definitive-quote")
    flow = _flow(db, popup, slug="vip")
    _offer(db, popup, flow)
    flow.contribution_enabled = True
    flow.contribution_percentage = Decimal("10")
    flow.allows_coupons = True
    section = FormSections(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        label="Buyer",
        order=0,
    )
    db.add(section)
    db.flush()
    field = FormFields(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        section_id=section.id,
        name="access_code",
        label="Access code",
        field_type="text",
        required=True,
    )
    db.add(field)
    flow.restriction_rule = {
        "kind": "form_answer",
        "field_name": field.name,
        "op": "eq",
        "value": "VIP",
    }
    product = _make_product(db, popup, price="100.00")
    product.max_per_order = 2
    product.total_stock_cap = 5
    product.total_stock_remaining = 5
    coupon = Coupons(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        code="VIP20",
        discount_value=20,
        is_active=True,
    )
    db.add_all([flow, product, coupon])
    db.commit()

    preview = _preview(
        client,
        popup,
        tenant_a,
        product,
        flow=flow,
        buyer=_buyer(form_data={field.name: "VIP"}),
        coupon_code=coupon.code,
    )
    assert preview.status_code == 200, preview.text
    quote = preview.json()
    assert quote["kind"] == "definitive"
    assert quote["quote_token"]
    assert quote["discount_amount"] == "20.00"
    assert quote["contribution_amount"] == "8.00"
    assert quote["total"] == "88.00"

    with patch("app.services.simplefi.get_simplefi_client") as simplefi:
        simplefi.return_value.create_payment.return_value = SimpleNamespace(
            id="sf_flow_quote",
            status="pending",
            checkout_url="https://simplefi.test/flow-quote",
            is_installment_plan=False,
        )
        purchase = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            params={"flow_slug": flow.slug},
            headers={"X-Tenant-Id": str(tenant_a.id)},
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": _buyer(form_data={field.name: "VIP"}),
                "coupon_code": coupon.code,
                "quote_token": quote["quote_token"],
            },
        )
    assert purchase.status_code == 200, purchase.text
    assert purchase.json()["amount"] == quote["total"]
    payment = db.exec(
        select(Payments).where(Payments.id == purchase.json()["payment_id"])
    ).one()
    assert payment.sales_flow_id == flow.id


def test_incomplete_context_is_estimate_and_shared_gate_rejects_invalid_context(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="estimate-quote")
    product = _make_product(db, popup)
    db.commit()

    estimate = _preview(client, popup, tenant_a, product)
    assert estimate.status_code == 200, estimate.text
    assert estimate.json()["kind"] == "estimate"
    assert estimate.json()["quote_token"] is None

    product.max_per_order = 1
    db.add(product)
    db.commit()
    excessive = _preview(client, popup, tenant_a, product, buyer=_buyer(), quantity=2)
    assert excessive.status_code == 422
    assert excessive.json()["detail"]["code"] == "quote_unavailable"

    product.max_per_order = None
    product.sale_ends_at = datetime.now(UTC) - timedelta(minutes=1)
    db.add(product)
    db.commit()
    ended = _preview(client, popup, tenant_a, product, buyer=_buyer())
    assert ended.status_code == 422
    assert product.name not in ended.text


def test_stale_quote_requotes_without_creating_charge(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="stale-quote")
    product = _make_product(db, popup, price="40.00")
    db.commit()
    preview = _preview(client, popup, tenant_a, product, buyer=_buyer("stale@test.com"))

    product.price = Decimal("55.00")
    db.add(product)
    db.commit()
    with patch("app.services.simplefi.get_simplefi_client") as simplefi:
        purchase = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            headers={"X-Tenant-Id": str(tenant_a.id)},
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": _buyer("stale@test.com"),
                "quote_token": preview.json()["quote_token"],
            },
        )

    assert purchase.status_code == 409
    assert purchase.json()["detail"]["code"] == "requote_required"
    assert purchase.json()["detail"]["fresh_quote"]["total"] == "55.00"
    simplefi.assert_not_called()
    assert (
        db.exec(select(Payments).where(Payments.popup_id == popup.id)).first() is None
    )


def test_ineligible_and_cross_popup_preview_fail_without_metadata(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="opaque-quote")
    other = _make_popup(db, tenant_a, slug_prefix="opaque-other")
    flow = _flow(db, popup, slug="members", type="upsale")
    _offer(db, popup, flow)
    foreign = _flow(db, other, slug="foreign")
    _offer(db, other, foreign)
    product = _make_product(db, popup)
    human = _make_human(db, tenant_a, suffix="quote-ineligible")
    db.commit()
    token = create_access_token(subject=human.id, token_type="human")

    ineligible = _preview(
        client, popup, tenant_a, product, flow=flow, buyer=_buyer(), token=token
    )
    cross_popup = _preview(client, popup, tenant_a, product, flow=foreign)

    assert ineligible.status_code == 403
    assert flow.name not in ineligible.text
    assert product.name not in ineligible.text
    assert cross_popup.status_code == 404
    assert foreign.name not in cross_popup.text
