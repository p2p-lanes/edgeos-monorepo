"""Task 13.1/13.2/13.4 — upsale-type flows on the checkout surface.

Design: sdd/sales-flows D8, G0 #2/#3. The checkout runtime and purchase
endpoints are public/anonymous by construction (module docstring in
checkout/router.py), but an upsale-type flow additionally requires a
portal-authenticated human with >=1 APPROVED payment in the popup.

Closes the slice-9 review gap: `resolve_flow`'s `require_types={direct,
upsale}` let an upsale flow resolve and serve a full anonymous checkout
with no entitlement check.

TDD: RED -> GREEN.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import FlowProducts, SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_direct_popup(db: Session, tenant: Tenants, *, slug_prefix: str) -> Popups:
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Upsale Gate Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.direct.value
    )
    db.flush()
    return popup


def _make_upsale_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Upsale {slug}",
        type="upsale",
    )
    db.add(flow)
    db.flush()
    return flow


def _make_purchase_body(product: Products, *, email: str) -> dict:
    return {
        "products": [{"product_id": str(product.id), "quantity": 1}],
        "buyer": {"email": email, "first_name": "Test", "last_name": "Buyer"},
    }


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"upsale-gate-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _grant_approved_payment(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> None:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="GA Ticket",
        slug=f"ga-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
    )
    db.add(product)
    db.flush()

    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Direct Attendee",
        category="main",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("50"),
        currency="USD",
    )
    db.add(payment)
    db.flush()

    db.add(
        PaymentProducts(
            tenant_id=tenant.id,
            payment_id=payment.id,
            product_id=product.id,
            attendee_id=attendee.id,
            quantity=1,
            product_name=product.name,
            product_price=product.price,
            product_category="ticket",
            product_currency="USD",
        )
    )
    db.flush()


# ---------------------------------------------------------------------------
# GET runtime
# ---------------------------------------------------------------------------


class TestUpsaleRuntimeGate:
    def test_anonymous_caller_gets_401_on_upsale_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="rt-anon")
        flow = _make_upsale_flow(db, popup, slug="addon")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 401, response.text

    def test_authenticated_ineligible_human_gets_403_on_upsale_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="rt-ineligible")
        flow = _make_upsale_flow(db, popup, slug="addon")
        human = _make_human(db, tenant_a, suffix="ineligible")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
        )
        assert response.status_code == 403, response.text

    def test_eligible_human_sees_upsale_runtime(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="rt-eligible")
        flow = _make_upsale_flow(db, popup, slug="addon")
        human = _make_human(db, tenant_a, suffix="eligible")
        _grant_approved_payment(db, tenant_a, popup, human)
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
        )
        assert response.status_code == 200, response.text

    def test_direct_type_flow_stays_anonymous(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Sanity: the gate is upsale-only, direct-type flows are unaffected."""
        popup = _make_direct_popup(db, tenant_a, slug_prefix="rt-direct")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# POST purchase
# ---------------------------------------------------------------------------


class TestUpsalePurchaseGate:
    def test_anonymous_purchase_against_upsale_flow_returns_401(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="pu-anon")
        flow = _make_upsale_flow(db, popup, slug="addon")
        product = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Addon Ticket",
            slug=f"addon-{uuid.uuid4().hex[:6]}",
            price=Decimal("0"),
        )
        db.add(product)
        db.commit()

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            params={"flow_slug": flow.slug},
            headers={"X-Tenant-Id": str(tenant_a.id)},
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "anon-buyer@test.com",
                    "first_name": "Anon",
                    "last_name": "Buyer",
                },
            },
        )
        assert response.status_code == 401, response.text

    def test_authenticated_ineligible_human_purchase_returns_403(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="pu-ineligible")
        flow = _make_upsale_flow(db, popup, slug="addon")
        human = _make_human(db, tenant_a, suffix="ineligible")
        product = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Addon Ticket",
            slug=f"addon-{uuid.uuid4().hex[:6]}",
            price=Decimal("0"),
        )
        db.add(product)
        db.commit()

        response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            params={"flow_slug": flow.slug},
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
            json=_make_purchase_body(product, email="ineligible@test.com"),
        )
        assert response.status_code == 403, response.text


class TestFlowScopedProductPurchase:
    """risk-001 bypass: a product assigned to a flow via flow_products must
    not be purchasable through a different flow of the same popup.

    sdd/sales-flows slice 12: this check was relocated from an inline
    422 "not available" filter into `services/restrictions/enforcement.py`,
    running BEFORE `humans_crud.find_or_create` (design's call-site table)
    and returning the stable 403 machine code `product_not_in_flow` (D6)
    instead of the ad hoc 422 slice 13 shipped ahead of this package's
    existence.
    """

    def test_flow_exclusive_product_rejected_via_default_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a, slug_prefix="fp-bypass")
        upsale_flow = _make_upsale_flow(db, popup, slug="addon")
        human = _make_human(db, tenant_a, suffix="fp-eligible")
        _grant_approved_payment(db, tenant_a, popup, human)
        product = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Upsale-Only Addon",
            slug=f"exclusive-{uuid.uuid4().hex[:6]}",
            price=Decimal("0"),
        )
        db.add(product)
        db.flush()
        db.add(
            FlowProducts(
                tenant_id=tenant_a.id, flow_id=upsale_flow.id, product_id=product.id
            )
        )
        db.commit()

        # Rejected through the default (direct) flow: the product is
        # flow-exclusive to the upsale flow, not this one.
        default_response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            headers={"X-Tenant-Id": str(tenant_a.id)},
            json=_make_purchase_body(product, email="bypass-attempt@test.com"),
        )
        assert default_response.status_code == 403, default_response.text
        assert default_response.json()["detail"] == "product_not_in_flow"

        # Purchasable through the upsale flow by an eligible human.
        upsale_response = client.post(
            f"/api/v1/checkout/{popup.slug}/purchase",
            params={"flow_slug": upsale_flow.slug},
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Authorization": f"Bearer {_human_token(human)}",
            },
            json=_make_purchase_body(product, email="legit-upsale@test.com"),
        )
        assert upsale_response.status_code == 200, upsale_response.text
