"""An invite says which flow it invites someone into.

Design: sdd/sales-flows-rediseno. Redeeming an invite creates an
application, and since F4 every application belongs to a flow. The invite
never named one, so the application landed in whichever flow the popup
called default — an invite meant for Volunteers put the person somewhere
else, with nothing to disagree with it.

Scenarios:
- An invite naming a flow lands its recipient in that flow.
- Omitting the flow keeps the old behaviour: the popup's default.
- A direct-sale flow is refused: it produces no application to redeem into.
- A flow of another popup is not found, and is not described back.
- "Already redeemed" is read per flow, not per popup.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import seed_default_steps


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Invite Flow Popup {uuid.uuid4().hex[:6]}",
        slug=f"invite-flow-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        invites_enabled=True,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    seed_default_steps(db, popup, sale_type="application")
    return popup


def _make_flow(
    db: Session, popup: Popups, *, flow_type: str = "application"
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type=flow_type,
        slug=f"flow-{uuid.uuid4().hex[:8]}",
        name="Volunteers",
    )
    # A flow created through the API copies its channel configuration from the
    # one already selling. Built directly, it would start with every setting
    # NULL — including the one that says whether it takes invites at all.
    sales_flows_crud.seed_config_from_popup(db, flow, popup.id)
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _create_invite(client: TestClient, token: str, popup: Popups, **extra) -> dict:
    resp = client.post(
        "/api/v1/invites",
        headers=_headers(token),
        json={"popup_id": str(popup.id), **extra},
    )
    return {"status": resp.status_code, "body": resp.json(), "text": resp.text}


class TestNamingTheFlow:
    def test_an_invite_can_name_a_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        volunteers = _make_flow(db, popup)

        result = _create_invite(
            client,
            admin_token_tenant_a,
            popup,
            sales_flow_id=str(volunteers.id),
        )

        assert result["status"] == 201, result["text"]
        assert result["body"]["sales_flow_id"] == str(volunteers.id)

    def test_omitting_it_keeps_the_default_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """What every invite did implicitly before it could say."""
        popup = _make_popup(db, tenant_a)

        result = _create_invite(client, admin_token_tenant_a, popup)

        assert result["status"] == 201, result["text"]
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None
        assert result["body"]["sales_flow_id"] == str(default_flow.id)

    def test_a_direct_flow_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """A direct sale produces no application, so there is nothing to
        redeem into."""
        popup = _make_popup(db, tenant_a)
        direct = _make_flow(db, popup, flow_type="direct")

        result = _create_invite(
            client, admin_token_tenant_a, popup, sales_flow_id=str(direct.id)
        )

        assert result["status"] == 422, result["text"]
        assert "application flows" in result["body"]["detail"]

    def test_a_flow_of_another_popup_is_not_found(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """404 before 422, so a flow the caller may not see is never
        described back to them."""
        popup = _make_popup(db, tenant_a)
        other_popup = _make_popup(db, tenant_a)
        foreign = _make_flow(db, other_popup, flow_type="direct")

        result = _create_invite(
            client, admin_token_tenant_a, popup, sales_flow_id=str(foreign.id)
        )

        assert result["status"] == 404, result["text"]


class TestRedeeming:
    def test_the_application_lands_in_the_invited_flow(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a
    ) -> None:
        """The bug this closes: the application used to land in the default
        flow whatever the invite was for."""
        popup = _make_popup(db, tenant_a)
        volunteers = _make_flow(db, popup)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None
        assert volunteers.id != default_flow.id

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"invited-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Inv",
            last_name="Itee",
        )
        db.add(human)
        invite = Invites(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            sales_flow_id=volunteers.id,
            token=f"tok-{uuid.uuid4().hex[:10]}",
            max_uses=1,
            created_by=admin_user_tenant_a.id,
        )
        db.add(invite)
        db.commit()
        db.refresh(human)
        db.refresh(invite)

        from app.api.application.schemas import ApplicationCreate

        application = applications_crud.create_internal(
            db,
            ApplicationCreate(
                popup_id=popup.id,
                sales_flow_id=invite.sales_flow_id,
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                email=human.email,
            ),
            tenant_id=tenant_a.id,
            human_id=human.id,
            validate_custom_fields=False,
        )

        assert application.sales_flow_id == volunteers.id

    def test_an_application_in_another_flow_does_not_block_the_invite(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Popup-wide, applying to the default flow read as having already
        redeemed an invite into Volunteers. Different flow, different
        application."""
        popup = _make_popup(db, tenant_a)
        volunteers = _make_flow(db, popup)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"elsewhere-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        db.add(
            Applications(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                human_id=human.id,
                sales_flow_id=default_flow.id,
                status="in review",
            )
        )
        db.commit()

        assert (
            applications_crud.get_by_human_flow(
                db, human_id=human.id, sales_flow_id=volunteers.id
            )
            is None
        )
