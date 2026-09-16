"""An application flow's checkout, reachable by the people it accepted.

Design: sdd/sales-flows-rediseno. The route refused application flows by
type, on the reading that their buyers go through the portal. They do — and
that portal page renders the same `ScrollyCheckoutFlow` as this one. The
only real difference is which payment call runs, so refusing by type asked
the wrong question: what separates an anonymous purchase from an
application-backed one is who is buying.

The gate is therefore about the buyer, and it has to be tight. This
endpoint is public and rate limited, so an application flow's catalog must
not be enumerable by anyone who has not been accepted INTO THAT FLOW.

Scenarios:
- Anonymous is asked to sign in, not told the flow does not exist.
- An authenticated stranger is refused.
- Accepted somewhere else in the same gathering is still refused.
- Accepted into this flow is served.
- Direct flows stay fully anonymous.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import seed_default_steps


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"App Checkout {uuid.uuid4().hex[:6]}",
        slug=f"app-checkout-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    seed_default_steps(db, popup, sale_type="application")
    return popup


def _make_flow(db: Session, popup: Popups, *, slug: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type="application",
        slug=slug,
        name=slug,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"buyer-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _accept(db: Session, popup: Popups, human: Humans, flow: SalesFlows) -> None:
    db.add(
        Applications(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            human_id=human.id,
            sales_flow_id=flow.id,
            status="accepted",
        )
    )
    db.commit()


def _human_headers(human: Humans, tenant: Tenants) -> dict[str, str]:
    token = create_access_token(human.id, token_type="human")
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-Id": str(tenant.id),
    }


def _runtime(client: TestClient, popup: Popups, flow: SalesFlows, headers: dict):
    return client.get(
        f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime", headers=headers
    )


class TestWhoGetsIn:
    def test_anonymous_is_asked_to_sign_in(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")

        resp = _runtime(client, popup, flow, {"X-Tenant-Id": str(tenant_a.id)})

        assert resp.status_code == 401, resp.text

    def test_an_authenticated_stranger_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Signed in is not the same as accepted, and this is the leak that
        matters: the endpoint is public and rate limited."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")
        stranger = _make_human(db, tenant_a)

        resp = _runtime(client, popup, flow, _human_headers(stranger, tenant_a))

        assert resp.status_code == 403, resp.text

    def test_accepted_into_another_flow_is_still_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Being accepted into the general intake says nothing about a
        partner flow that asks its own questions."""
        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")
        elsewhere = _make_flow(db, popup, slug=f"other-{uuid.uuid4().hex[:6]}")
        human = _make_human(db, tenant_a)
        _accept(db, popup, human, elsewhere)

        resp = _runtime(client, popup, partner, _human_headers(human, tenant_a))

        assert resp.status_code == 403, resp.text

    def test_accepted_into_this_flow_is_served(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug=f"partner-{uuid.uuid4().hex[:6]}")
        human = _make_human(db, tenant_a)
        _accept(db, popup, human, flow)

        resp = _runtime(client, popup, flow, _human_headers(human, tenant_a))

        assert resp.status_code == 200, resp.text


class TestDirectFlowsAreUnaffected:
    def test_a_direct_flow_stays_anonymous(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The gate is a no-op for anything that is not an application
        flow — an open checkout must not start asking people to sign in."""
        popup = Popups(
            tenant_id=tenant_a.id,
            name=f"Direct {uuid.uuid4().hex[:6]}",
            slug=f"direct-{uuid.uuid4().hex[:8]}",
            sale_type=SaleType.direct.value,
            status="active",
            currency="USD",
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)
        flow = seed_default_steps(db, popup, sale_type="direct")

        resp = _runtime(client, popup, flow, {"X-Tenant-Id": str(tenant_a.id)})

        assert resp.status_code == 200, resp.text
