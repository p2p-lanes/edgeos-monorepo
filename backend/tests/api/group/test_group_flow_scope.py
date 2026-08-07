"""A group says which flow its members apply through.

Design: sdd/sales-flows-rediseno. Joining a group produces an application,
and since F4 every application belongs to a flow. The group never named one,
so a group made for a partner organisation — with its own questions and its
own acceptance email — quietly sent everyone through the general flow.

Scenarios:
- A group can name a flow, and omitting it keeps the default.
- A direct-sale flow is refused: a group is only ever read through an
  application.
- Joining lands the person in the group's flow, not the popup's default.
- A request naming a different flow is a disagreement, answered with 422
  rather than by silently picking a side.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.schemas import ApplicationCreate
from app.api.group.models import Groups
from app.api.human.models import Humans
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
        name=f"Group Flow Popup {uuid.uuid4().hex[:6]}",
        slug=f"group-flow-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
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
        name="Partner Org",
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"member-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Mem",
        last_name="Ber",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _create_group(client: TestClient, token: str, popup: Popups, **extra) -> dict:
    resp = client.post(
        "/api/v1/groups",
        headers=_headers(token),
        json={
            "popup_id": str(popup.id),
            "name": f"Group {uuid.uuid4().hex[:6]}",
            **extra,
        },
    )
    return {"status": resp.status_code, "body": resp.json(), "text": resp.text}


class TestNamingTheFlow:
    def test_a_group_can_name_a_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup)

        result = _create_group(
            client, admin_token_tenant_a, popup, sales_flow_id=str(partner.id)
        )

        assert result["status"] == 201, result["text"]
        assert result["body"]["sales_flow_id"] == str(partner.id)

    def test_omitting_it_keeps_the_default_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)

        result = _create_group(client, admin_token_tenant_a, popup)

        assert result["status"] == 201, result["text"]
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None
        assert result["body"]["sales_flow_id"] == str(default_flow.id)

    def test_a_direct_flow_is_refused(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        """A group is only ever reached through an application."""
        popup = _make_popup(db, tenant_a)
        direct = _make_flow(db, popup, flow_type="direct")

        result = _create_group(
            client, admin_token_tenant_a, popup, sales_flow_id=str(direct.id)
        )

        assert result["status"] == 422, result["text"]
        assert "application flows" in result["body"]["detail"]


class TestJoining:
    def _group(self, db: Session, popup: Popups, flow: SalesFlows) -> Groups:
        group = Groups(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            name=f"Partner {uuid.uuid4().hex[:6]}",
            slug=f"partner-{uuid.uuid4().hex[:8]}",
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        return group

    def test_the_member_lands_in_the_group_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The bug this closes: the application landed in the default flow
        whatever the group was for."""
        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None
        assert partner.id != default_flow.id

        group = self._group(db, popup, partner)
        human = _make_human(db, tenant_a)

        application = applications_crud.create_internal(
            db,
            ApplicationCreate(
                popup_id=popup.id,
                group_id=group.id,
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                email=human.email,
            ),
            tenant_id=tenant_a.id,
            human_id=human.id,
            validate_custom_fields=False,
        )

        assert application.sales_flow_id == partner.id

    def test_a_request_naming_another_flow_is_refused(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Picking a side silently is how a group's own form and emails
        stopped reaching anybody in the first place."""
        import pytest
        from fastapi import HTTPException

        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup)
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert default_flow is not None

        group = self._group(db, popup, partner)
        human = _make_human(db, tenant_a)

        with pytest.raises(HTTPException) as exc_info:
            applications_crud.create_internal(
                db,
                ApplicationCreate(
                    popup_id=popup.id,
                    group_id=group.id,
                    sales_flow_id=default_flow.id,
                    first_name=human.first_name or "",
                    last_name=human.last_name or "",
                    email=human.email,
                ),
                tenant_id=tenant_a.id,
                human_id=human.id,
                validate_custom_fields=False,
            )

        assert exc_info.value.status_code == 422
        assert "different sales flow" in exc_info.value.detail

    def test_naming_the_group_own_flow_is_fine(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        partner = _make_flow(db, popup)
        group = self._group(db, popup, partner)
        human = _make_human(db, tenant_a)

        application = applications_crud.create_internal(
            db,
            ApplicationCreate(
                popup_id=popup.id,
                group_id=group.id,
                sales_flow_id=partner.id,
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                email=human.email,
            ),
            tenant_id=tenant_a.id,
            human_id=human.id,
            validate_custom_fields=False,
        )

        assert application.sales_flow_id == partner.id
