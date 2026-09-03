"""Each door decides whether it takes invites, and when it writes.

Design: sdd/sales-flows-rediseno, `docs/sales-flows-que-mover.md` slice 4.

- An invite already names the flow it lands its recipient in
  (`invites.sales_flow_id` is NOT NULL), so the switch that allows one belongs
  to that same flow. Asking the event meant opening invites for a partner's
  door opened them for general entry too.
- The check-in email's template has been flow-owned since the redesign, so
  when it goes out follows the wording it goes out in.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType, UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from tests._flow_helpers import provision_default_flow


def _popup(db: Session, tenant: Tenants, **flags) -> Popups:
    popup = Popups(
        name=f"Slice Four {uuid.uuid4().hex[:8]}",
        slug=f"slice-four-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=SaleType.application,
        status="active",
        start_date=datetime.now(UTC) + timedelta(days=10),
        end_date=datetime.now(UTC) + timedelta(days=20),
        **flags,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=SaleType.application.value)
    db.commit()
    return popup


def _default_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    assert flow is not None
    return flow


def _set(db: Session, flow: SalesFlows, **values) -> SalesFlows:
    for name, value in values.items():
        setattr(flow, name, value)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _creator(db: Session, popup: Popups) -> Users:
    """An admin to hang the invite on — `invites.created_by` is NOT NULL."""
    user = Users(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        email=f"creator-{uuid.uuid4().hex[:8]}@test.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"slice4-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ana",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _invite(db: Session, popup: Popups, flow: SalesFlows) -> Invites:
    invite = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        token=f"tok-{uuid.uuid4().hex[:10]}",
        created_by=_creator(db, popup).id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


class TestInvitesGate:
    def test_the_flow_takes_invites_the_event_does_not(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, invites_enabled=False)
        flow = _set(db, _default_flow(db, popup), invites_enabled=True)
        invite = _invite(db, popup, flow)

        resp = client.get(f"/api/v1/invites/redeem/{invite.token}")

        assert resp.status_code == 200, resp.text

    def test_the_flow_refuses_invites_the_event_allows(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, invites_enabled=True)
        flow = _set(db, _default_flow(db, popup), invites_enabled=False)
        invite = _invite(db, popup, flow)

        resp = client.get(f"/api/v1/invites/redeem/{invite.token}")

        assert resp.status_code == 410, resp.text

    def test_two_doors_answer_differently(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A partner's door can take invites while general entry does not."""
        popup = _popup(db, tenant_a, invites_enabled=False)
        closed = _set(db, _default_flow(db, popup), invites_enabled=False)
        partner = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"partner-{uuid.uuid4().hex[:8]}",
            name="Partner",
            type=SaleType.application.value,
            invites_enabled=True,
        )
        db.add(partner)
        db.commit()
        db.refresh(partner)

        through_closed = client.get(
            f"/api/v1/invites/redeem/{_invite(db, popup, closed).token}"
        )
        through_partner = client.get(
            f"/api/v1/invites/redeem/{_invite(db, popup, partner).token}"
        )

        assert through_closed.status_code == 410, through_closed.text
        assert through_partner.status_code == 200, through_partner.text


class TestCheckinPassTiming:
    def test_only_the_door_whose_window_is_open_sends(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Two doors at one event, ten days out. One asked for fourteen days'
        notice and is due; the other asked for three and is not."""
        from app.services.checkin_pass_dispatch import _due_flows

        popup = _popup(db, tenant_a)
        early = _set(db, _default_flow(db, popup), checkin_pass_lead_days=14)
        late = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"late-{uuid.uuid4().hex[:8]}",
            name="Late",
            type=SaleType.application.value,
            checkin_pass_lead_days=3,
        )
        db.add(late)
        db.commit()

        due = _due_flows(db, datetime.now(UTC))

        due_ids = {flow.id for flow, _ in due}
        assert early.id in due_ids
        assert late.id not in due_ids

    def test_a_door_that_never_asked_sends_nothing(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.services.checkin_pass_dispatch import _due_flows

        popup = _popup(db, tenant_a, checkin_pass_lead_days=14)
        silent = _set(db, _default_flow(db, popup), checkin_pass_lead_days=None)

        due = _due_flows(db, datetime.now(UTC))

        assert silent.id not in {flow.id for flow, _ in due}

    def test_a_direct_purchase_is_answered_for_by_the_default_door(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A ticket bought without applying names no door. The default flow
        picks it up, or nobody would and the buyer never gets a QR."""
        from app.api.attendee.crud import attendees_crud

        popup = _popup(db, tenant_a)
        default = _set(db, _default_flow(db, popup), checkin_pass_lead_days=14)
        product = Products(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            name="Ticket",
            slug=f"ticket-{uuid.uuid4().hex[:8]}",
            price=100,
            category="ticket",
            is_active=True,
            requires_check_in=True,
        )
        db.add(product)
        human = _human(db, tenant_a)
        attendee = Attendees(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            application_id=None,  # bought without applying
            human_id=human.id,
            name="Ana",
            email=human.email,
            category="main",
        )
        db.add(attendee)
        db.commit()
        db.add(
            AttendeeProducts(
                tenant_id=popup.tenant_id,
                attendee_id=attendee.id,
                product_id=product.id,
                quantity=1,
                check_in_code=f"code-{uuid.uuid4().hex[:8]}",
                product_category_snapshot="ticket",
                requires_check_in_snapshot=True,
            )
        )
        db.commit()

        picked_up = attendees_crud.find_unsent_checkin_pass_tickets(
            db, popup.id, sales_flow_id=default.id, include_flowless=True
        )
        ignored = attendees_crud.find_unsent_checkin_pass_tickets(
            db, popup.id, sales_flow_id=default.id, include_flowless=False
        )

        assert len(picked_up) == 1
        assert ignored == []

    def test_a_ticket_belongs_to_the_door_it_was_bought_through(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.attendee.crud import attendees_crud

        popup = _popup(db, tenant_a)
        default = _default_flow(db, popup)
        partner = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"partner-{uuid.uuid4().hex[:8]}",
            name="Partner",
            type=SaleType.application.value,
        )
        db.add(partner)
        db.commit()
        db.refresh(partner)

        product = Products(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            name="Ticket",
            slug=f"ticket-{uuid.uuid4().hex[:8]}",
            price=100,
            category="ticket",
            is_active=True,
            requires_check_in=True,
        )
        db.add(product)
        human = _human(db, tenant_a)
        application = Applications(
            sales_flow_id=partner.id,
            id=uuid.uuid4(),
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
            name="Ana",
            email=human.email,
            category="main",
        )
        db.add(attendee)
        db.commit()
        db.add(
            AttendeeProducts(
                tenant_id=popup.tenant_id,
                attendee_id=attendee.id,
                product_id=product.id,
                quantity=1,
                check_in_code=f"code-{uuid.uuid4().hex[:8]}",
                product_category_snapshot="ticket",
                requires_check_in_snapshot=True,
            )
        )
        db.commit()

        through_partner = attendees_crud.find_unsent_checkin_pass_tickets(
            db, popup.id, sales_flow_id=partner.id
        )
        through_default = attendees_crud.find_unsent_checkin_pass_tickets(
            db, popup.id, sales_flow_id=default.id, include_flowless=True
        )

        assert len(through_partner) == 1
        assert through_default == []
