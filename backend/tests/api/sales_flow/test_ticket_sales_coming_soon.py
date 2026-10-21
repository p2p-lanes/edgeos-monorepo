"""Holding a flow's ticket sales as "coming soon" (SIM-48).

An organiser can accept people before anything is on sale. While a flow's
`ticket_sales_status` is `coming_soon` it keeps taking applications, the
portal shows the flow's coming-soon copy instead of a checkout, and every
purchase path refuses, so a kept link or a scripted request cannot buy early.

Not `status = closed`: a closed flow takes nothing at all.
"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowTicketSalesStatus
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id, seed_default_steps


@pytest.fixture(autouse=True)
def disable_purchase_rate_limit():
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def _popup(db: Session, tenant: Tenants, *, sale_type: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Coming Soon {uuid.uuid4().hex[:6]}",
        slug=f"coming-soon-{uuid.uuid4().hex[:8]}",
        sale_type=sale_type,
        status="active",
        simplefi_api_key="simplefi_test_key",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    seed_default_steps(db, popup, sale_type=sale_type)
    db.commit()
    db.refresh(popup)
    return popup


def _product(db: Session, popup: Popups) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="GA",
        slug=f"ga-{uuid.uuid4().hex[:8]}",
        price=Decimal("100.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _hold_sales(db: Session, flow: SalesFlows, **texts) -> SalesFlows:
    flow.ticket_sales_status = SalesFlowTicketSalesStatus.coming_soon
    for name, value in texts.items():
        setattr(flow, name, value)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _patch(client: TestClient, token: str, flow_id, body: dict):
    return client.patch(
        f"/api/v1/sales-flows/{flow_id}",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
    )


class TestTheSwitch:
    def test_a_flow_sells_unless_someone_says_otherwise(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)

        resp = client.get(
            f"/api/v1/sales-flows/{flow.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ticket_sales_status"] == "open"
        assert resp.json()["coming_soon_title"] is None
        assert resp.json()["coming_soon_message"] is None

    def test_an_operator_holds_sales_with_their_own_copy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)

        resp = _patch(
            client,
            admin_token_tenant_a,
            flow.id,
            {
                "ticket_sales_status": "coming_soon",
                "coming_soon_title": "Tickets drop in May",
                "coming_soon_message": "We'll email you the moment they do.",
            },
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ticket_sales_status"] == "coming_soon"
        assert body["coming_soon_title"] == "Tickets drop in May"
        assert body["coming_soon_message"] == "We'll email you the moment they do."

    def test_and_opens_them_again(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _hold_sales(db, _default_flow(db, popup))

        resp = _patch(
            client, admin_token_tenant_a, flow.id, {"ticket_sales_status": "open"}
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ticket_sales_status"] == "open"

    def test_an_unrelated_save_keeps_the_hold_and_its_copy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Partial PATCH: renaming the flow must not reopen sales or wipe the
        message the organiser wrote."""
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _hold_sales(
            db,
            _default_flow(db, popup),
            coming_soon_title="Soon",
            coming_soon_message="Hang tight.",
        )

        resp = _patch(client, admin_token_tenant_a, flow.id, {"name": "Renamed"})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Renamed"
        assert body["ticket_sales_status"] == "coming_soon"
        assert body["coming_soon_title"] == "Soon"
        assert body["coming_soon_message"] == "Hang tight."

    def test_the_status_can_be_switched_but_never_cleared(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)

        cleared = _patch(
            client, admin_token_tenant_a, flow.id, {"ticket_sales_status": None}
        )
        unknown = _patch(
            client, admin_token_tenant_a, flow.id, {"ticket_sales_status": "maybe"}
        )

        assert cleared.status_code == 422, cleared.text
        assert unknown.status_code == 422, unknown.text

    def test_blank_copy_falls_back_to_the_portal_default(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _hold_sales(db, _default_flow(db, popup), coming_soon_title="Old title")

        resp = _patch(
            client,
            admin_token_tenant_a,
            flow.id,
            {"coming_soon_title": "   ", "coming_soon_message": ""},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["coming_soon_title"] is None
        assert resp.json()["coming_soon_message"] is None

    def test_the_copy_has_a_ceiling(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        flow = _default_flow(db, popup)

        resp = _patch(
            client, admin_token_tenant_a, flow.id, {"coming_soon_title": "x" * 201}
        )

        assert resp.status_code == 422, resp.text


def _human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"coming-soon-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
        last_name="Diaz",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _accepted(db: Session, popup: Popups, human: Humans):
    application = Applications(
        id=uuid.uuid4(),
        sales_flow_id=application_flow_id(db, popup.id),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Ana Diaz",
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(application)
    db.refresh(attendee)
    return application, attendee


def _my_payment(client, path, human, application, product, attendee):
    token = create_access_token(subject=human.id, token_type="human")
    return client.post(
        f"/api/v1/payments/my{path}",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "application_id": str(application.id),
            "products": [
                {
                    "product_id": str(product.id),
                    "attendee_id": str(attendee.id),
                    "quantity": 1,
                }
            ],
        },
    )


class TestAnAcceptedApplicantWaits:
    def test_the_quote_is_refused_while_sales_are_held(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        product = _product(db, popup)
        human = _human(db, tenant_a)
        application, attendee = _accepted(db, popup, human)
        _hold_sales(db, _default_flow(db, popup))

        resp = _my_payment(client, "/preview", human, application, product, attendee)

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "Ticket sales are not open yet"

    def test_the_purchase_is_refused_while_sales_are_held(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        product = _product(db, popup)
        human = _human(db, tenant_a)
        application, attendee = _accepted(db, popup, human)
        _hold_sales(db, _default_flow(db, popup))

        resp = _my_payment(client, "", human, application, product, attendee)

        assert resp.status_code == 403, resp.text

    def test_the_same_quote_goes_through_once_sales_open(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        product = _product(db, popup)
        human = _human(db, tenant_a)
        application, attendee = _accepted(db, popup, human)

        resp = _my_payment(client, "/preview", human, application, product, attendee)

        assert resp.status_code == 200, resp.text

    def test_the_portal_is_told_what_to_show_instead(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.application.value)
        human = _human(db, tenant_a)
        _accepted(db, popup, human)
        flow = _hold_sales(
            db,
            _default_flow(db, popup),
            coming_soon_title="Soon",
            coming_soon_message="Hang tight.",
        )
        headers = {
            "Authorization": "Bearer "
            + create_access_token(subject=human.id, token_type="human")
        }

        listing = client.get(
            f"/api/v1/sales-flows/portal?popup_id={popup.id}", headers=headers
        )
        config = client.get(
            f"/api/v1/sales-flows/portal/checkout-config?popup_id={popup.id}",
            headers=headers,
        )

        assert listing.status_code == 200, listing.text
        listed = next(f for f in listing.json()["results"] if f["id"] == str(flow.id))
        assert listed["ticket_sales_status"] == "coming_soon"
        assert listed["coming_soon_title"] == "Soon"
        assert listed["coming_soon_message"] == "Hang tight."
        assert config.status_code == 200, config.text
        assert config.json()["ticket_sales_status"] == "coming_soon"
        assert config.json()["coming_soon_message"] == "Hang tight."


class TestTheOpenCheckoutWaitsToo:
    def _purchase(self, client: TestClient, popup: Popups, flow, product):
        return client.post(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
            json={
                "products": [{"product_id": str(product.id), "quantity": 1}],
                "buyer": {
                    "email": "buyer@test.com",
                    "first_name": "Ana",
                    "last_name": "Diaz",
                },
            },
            headers={"X-Tenant-Id": str(popup.tenant_id)},
        )

    def test_the_runtime_still_loads_and_says_why(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.direct.value)
        flow = _hold_sales(db, _default_flow(db, popup), coming_soon_title="Soon")

        resp = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert resp.status_code == 200, resp.text
        config = resp.json()["checkout_config"]
        assert config["ticket_sales_status"] == "coming_soon"
        assert config["coming_soon_title"] == "Soon"

    def test_a_purchase_is_refused_while_sales_are_held(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.direct.value)
        product = _product(db, popup)
        flow = _hold_sales(db, _default_flow(db, popup))

        with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
            resp = self._purchase(client, popup, flow, product)

        assert resp.status_code == 403, resp.text
        mock_get_client.return_value.create_payment.assert_not_called()

    def test_the_same_purchase_goes_through_once_sales_open(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, sale_type=SaleType.direct.value)
        product = _product(db, popup)
        flow = _default_flow(db, popup)

        with patch("app.services.simplefi.get_simplefi_client") as mock_get_client:
            mock_get_client.return_value.create_payment.return_value = SimpleNamespace(
                id=f"sf_{uuid.uuid4().hex[:8]}",
                status="pending",
                checkout_url="https://simplefi.test/checkout/open",
                is_installment_plan=False,
            )
            resp = self._purchase(client, popup, flow, product)

        assert resp.status_code == 200, resp.text
