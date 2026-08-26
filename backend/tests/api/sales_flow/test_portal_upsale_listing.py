"""Task 13.3 — GET /sales-flows/portal/upsale (portal upsale catalog surface).

Design: sdd/sales-flows G0 #2/#3, D8. Separate from GET /sales-flows/portal
(which backs the application FlowPicker and must stay unaffected — mixing
upsale flows into that listing would break its single-flow auto-select
semantics). Portal-auth required (CurrentHuman); an ineligible or unpaid
human sees an empty catalog rather than an error, matching the listing
semantics of `find_portal_listed` elsewhere.

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
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"upsale-listing-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="direct"
    )
    db.flush()
    return popup


def _make_upsale_flow(
    db: Session, popup: Popups, *, slug: str, visibility: str = "portal_listed"
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Upsale {slug}",
        type="upsale",
        visibility=visibility,
    )
    db.add(flow)
    db.flush()
    return flow


def _human_token(db: Session, tenant: Tenants) -> tuple[str, Humans]:
    human = Humans(
        tenant_id=tenant.id,
        email=f"upsale-listing-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human"), human


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


def _offer_product(db: Session, flow: SalesFlows, product: Products) -> None:
    db.add(
        TicketingSteps(
            tenant_id=flow.tenant_id,
            popup_id=flow.popup_id,
            sales_flow_id=flow.id,
            step_type="tickets",
            title="Tickets",
            product_category="ticket",
            template="ticket-select",
            template_config={
                "sections": [
                    {
                        "key": "tickets",
                        "label": "Tickets",
                        "product_ids": [str(product.id)],
                    }
                ]
            },
        )
    )


class TestPortalUpsaleListing:
    def test_eligible_human_sees_upsale_catalog(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_upsale_flow(db, popup, slug="addon")
        flow.open_checkout_signing_secret = "the-key-that-signs-orders"
        token, human = _human_token(db, tenant_a)
        _grant_approved_payment(db, tenant_a, popup, human)
        product = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Addon",
            slug=f"addon-{uuid.uuid4().hex[:6]}",
            price=Decimal("75"),
        )
        db.add(product)
        db.flush()
        _offer_product(db, flow, product)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/upsale",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["results"] == [
            {
                "id": str(flow.id),
                "slug": flow.slug,
                "name": flow.name,
                "order": flow.order,
                "type": flow.type,
                "price_summary": {
                    "amount": "75.00",
                    "currency": "USD",
                    "kind": "fixed",
                },
            }
        ]

    def test_ticket_holder_without_speaker_credential_cannot_see_vip_dinner(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        speaker_credential = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Speaker Credential",
            slug=f"speaker-{uuid.uuid4().hex[:6]}",
            price=Decimal("0"),
        )
        db.add(speaker_credential)
        db.flush()
        vip_dinner = _make_upsale_flow(db, popup, slug="vip-dinner")
        vip_dinner.restriction_rule = {
            "kind": "has_product",
            "scope": "product",
            "value": str(speaker_credential.id),
        }
        token, human = _human_token(db, tenant_a)
        _grant_approved_payment(db, tenant_a, popup, human)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/upsale",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["results"] == []

    def test_ineligible_human_sees_empty_catalog(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_upsale_flow(db, popup, slug="addon")
        token, _human = _human_token(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/upsale",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["results"] == []

    def test_anonymous_caller_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/upsale",
            params={"popup_id": str(popup.id)},
        )
        assert response.status_code in (401, 403), response.text
