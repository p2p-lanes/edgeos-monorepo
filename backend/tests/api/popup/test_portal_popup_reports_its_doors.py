"""The portal is told what a gathering's doors do, not what its column says.

`sale_type` is a single value on the popup and cannot describe an event that
takes applications through one door and sells through another. The portal reads
`takes_applications` / `sells_directly` instead, derived from the flows.

The list endpoints were stamped when the pair was introduced. This covers the
detail endpoint, which the SSR entry point fetches directly, and in particular
the translated branch: it serializes the model, overlays translations onto the
dict and re-validates, which resets any field the overlay does not carry. Stamp
before that round trip and a Spanish-speaking buyer is told every gathering
takes applications.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import provision_default_flow


def _popup_taking_applications(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Doors {uuid.uuid4().hex[:6]}",
        slug=f"doors-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _add_selling_door(db: Session, popup: Popups) -> None:
    db.add(
        SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"sponsors-{uuid.uuid4().hex[:8]}",
            name="Sponsors",
            type=SaleType.direct.value,
        )
    )
    db.commit()


def _human_token(db: Session, tenant: Tenants) -> str:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"doors-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


def _fetch(client: TestClient, popup: Popups, token: str, **headers) -> dict:
    resp = client.get(
        f"/api/v1/popups/portal/{popup.slug}",
        headers={"Authorization": f"Bearer {token}", **headers},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPortalPopupDetail:
    def test_it_reports_complete_invoice_configuration(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup_taking_applications(db, tenant_a)
        popup.invoice_company_name = "Festival Org"
        popup.invoice_company_address = "1 Event Way"
        popup.invoice_company_email = "billing@example.test"
        db.add(popup)
        db.commit()

        body = _fetch(client, popup, _human_token(db, tenant_a))

        assert body["invoice_company_name"] == "Festival Org"
        assert body["invoice_company_address"] == "1 Event Way"
        assert body["invoice_company_email"] == "billing@example.test"

    def test_it_reports_a_door_that_sells_on_an_application_event(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup_taking_applications(db, tenant_a)
        _add_selling_door(db, popup)

        body = _fetch(client, popup, _human_token(db, tenant_a))

        # The column still says `application`. The doors say both.
        assert body["sale_type"] == SaleType.application.value
        assert body["takes_applications"] is True
        assert body["sells_directly"] is True

    def test_an_event_with_no_selling_door_says_so(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup_taking_applications(db, tenant_a)

        body = _fetch(client, popup, _human_token(db, tenant_a))

        assert body["takes_applications"] is True
        assert body["sells_directly"] is False

    def test_the_translated_response_keeps_the_flags(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The regression this file exists for: the overlay branch rebuilds
        the model from a dict, so anything stamped before it is lost."""
        popup = _popup_taking_applications(db, tenant_a)
        _add_selling_door(db, popup)

        body = _fetch(
            client, popup, _human_token(db, tenant_a), **{"Accept-Language": "es"}
        )

        assert body["takes_applications"] is True
        assert body["sells_directly"] is True
