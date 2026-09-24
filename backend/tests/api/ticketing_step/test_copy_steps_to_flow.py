"""Copying a flow's checkout steps into another flow.

How a new flow gets a checkout without inheriting one
(sdd/sales-flows-rediseno R3). Copying is a one-time event: afterwards the
two flows are independent, which is the whole difference between this and
the fallback the redesign removed.

Scenarios:
- The copy produces independent rows; editing one flow never reaches the other.
- Copying replaces the target's steps rather than appending, so a second
  call does not duplicate them.
- Copying from a flow with no steps empties the target — the honest answer.
- A source flow from another popup is rejected before anything is written.
"""

import uuid
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee_category.crud import attendee_categories_crud
from app.api.attendee_category.schemas import AttendeeCategoryCreate
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.crud import ticketing_steps_crud
from app.api.ticketing_step.models import TicketingSteps
from tests._flow_helpers import provision_default_flow


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Copy Steps Popup {uuid.uuid4().hex[:6]}",
        slug=f"copy-steps-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_flow(
    db: Session, popup: Popups, *, slug: str, flow_type: str = "direct"
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type=flow_type,
        slug=slug,
        name=slug,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_step(
    db: Session,
    popup: Popups,
    flow: SalesFlows,
    *,
    title: str,
    order: int = 0,
    template: str | None = None,
    template_config: dict | None = None,
) -> TicketingSteps:
    step = TicketingSteps(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        step_type="tickets",
        product_category="ticket",
        title=title,
        order=order,
        template=template,
        template_config=template_config,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return step


def _titles(db: Session, flow_id: uuid.UUID) -> list[str]:
    steps, _ = ticketing_steps_crud.find_by_flow(db, flow_id, limit=100)
    return [s.title for s in steps]


class TestCopyStepsToFlow:
    def test_copied_category_filters_belong_to_target_and_allow_editing(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(db, popup, slug=f"src-{uuid.uuid4().hex[:6]}")
        main = attendee_categories_crud.seed_main_for_flow(db, source)
        guest = attendee_categories_crud.create_for_flow(
            db, AttendeeCategoryCreate(popup_id=popup.id, key="guest"), source
        )
        config: dict = {
            "sections": [
                {
                    "key": "main",
                    "label": "Main tickets",
                    "product_ids": [str(uuid.uuid4())],
                    "attendee_categories": [str(main.id)],
                },
                {
                    "key": "shared",
                    "label": "Shared tickets",
                    "attendee_categories": [str(guest.id), str(main.id)],
                },
                {"key": "empty", "label": "Empty", "attendee_categories": []},
                {"key": "all", "label": "All", "attendee_categories": None},
                {"key": "unspecified", "label": "Unspecified"},
            ],
            "layout": {"columns": 2},
        }
        original = _make_step(
            db,
            popup,
            source,
            title="Tickets",
            template="ticket-select",
            template_config=deepcopy(config),
        )
        headers = _headers(admin_token_tenant_a)
        created = client.post(
            "/api/v1/sales-flows",
            headers=headers,
            json={
                "popup_id": str(popup.id),
                "name": "Copied flow",
                "slug": f"copy-{uuid.uuid4().hex[:6]}",
                "type": source.type,
                "start_from": str(source.id),
            },
        )
        assert created.status_code == 201, created.text
        target_id = uuid.UUID(created.json()["id"])
        target_categories = {
            category.key: str(category.id)
            for category in attendee_categories_crud.list_by_flow(db, target_id)
        }
        expected = deepcopy(config)
        expected["sections"][0]["attendee_categories"] = [target_categories["main"]]
        expected["sections"][1]["attendee_categories"] = [
            target_categories["guest"],
            target_categories["main"],
        ]

        for _ in range(2):
            response = client.post(
                f"/api/v1/ticketing-steps/copy-to-flow/{target_id}",
                headers=headers,
                json={"source_flow_id": str(source.id)},
            )
            assert response.status_code == 200, response.text
            assert response.json()["steps"] == 1
            copied, total = ticketing_steps_crud.find_by_flow(db, target_id)
            assert total == 1
            assert copied[0].id != original.id
            assert copied[0].template_config == expected

            edited = client.patch(
                f"/api/v1/ticketing-steps/{copied[0].id}",
                headers=headers,
                json={"title": "Renamed copy"},
            )
            assert edited.status_code == 200, edited.text
            assert edited.json()["title"] == "Renamed copy"
            assert edited.json()["template_config"] == expected

        db.refresh(original)
        assert original.title == "Tickets"
        assert original.template_config == config

    @pytest.mark.parametrize("target_category_state", ["missing", "deleted"])
    def test_unmapped_categories_are_removed_without_broadening_filters(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a,
        target_category_state: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(db, popup, slug=f"src-{uuid.uuid4().hex[:6]}")
        target = _make_flow(db, popup, slug=f"tgt-{uuid.uuid4().hex[:6]}")
        source_main = attendee_categories_crud.seed_main_for_flow(db, source)
        target_main = attendee_categories_crud.seed_main_for_flow(db, target)
        guest = attendee_categories_crud.create_for_flow(
            db, AttendeeCategoryCreate(popup_id=popup.id, key="guest"), source
        )
        if target_category_state == "deleted":
            target_guest = attendee_categories_crud.create_for_flow(
                db, AttendeeCategoryCreate(popup_id=popup.id, key="guest"), target
            )
            attendee_categories_crud.delete_category(db, target_guest)
        config = {
            "sections": [
                {
                    "key": "mixed",
                    "label": "Mixed",
                    "attendee_categories": [str(source_main.id), str(guest.id)],
                },
                {
                    "key": "guest",
                    "label": "Guest",
                    "attendee_categories": [str(guest.id)],
                },
            ]
        }
        original = _make_step(
            db,
            popup,
            source,
            title="Tickets",
            template="ticket-select",
            template_config=deepcopy(config),
        )
        headers = _headers(admin_token_tenant_a)
        response = client.post(
            f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
            headers=headers,
            json={"source_flow_id": str(source.id)},
        )
        assert response.status_code == 200, response.text
        copied, _ = ticketing_steps_crud.find_by_flow(db, target.id)
        assert copied[0].template_config is not None
        sections = copied[0].template_config["sections"]
        assert sections[0]["attendee_categories"] == [str(target_main.id)]
        assert sections[1]["attendee_categories"] == []
        edited = client.patch(
            f"/api/v1/ticketing-steps/{copied[0].id}",
            headers=headers,
            json={"title": "Renamed copy"},
        )
        assert edited.status_code == 200, edited.text
        db.refresh(original)
        assert original.template_config == config

    def test_the_copy_is_independent_of_its_source(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(db, popup, slug=f"src-{uuid.uuid4().hex[:6]}")
        target = _make_flow(db, popup, slug=f"tgt-{uuid.uuid4().hex[:6]}")
        original = _make_step(db, popup, source, title="Tickets")

        resp = client.post(
            f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(source.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["steps"] == 1
        assert _titles(db, target.id) == ["Tickets"]

        original.title = "Renamed in the source"
        db.add(original)
        db.commit()

        assert _titles(db, target.id) == ["Tickets"], (
            "the copy must be its own row, not a view of the source"
        )

    def test_copying_twice_replaces_rather_than_appends(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(db, popup, slug=f"src2-{uuid.uuid4().hex[:6]}")
        target = _make_flow(db, popup, slug=f"tgt2-{uuid.uuid4().hex[:6]}")
        _make_step(db, popup, source, title="Tickets")

        for _ in range(2):
            resp = client.post(
                f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
                headers=_headers(admin_token_tenant_a),
                json={"source_flow_id": str(source.id)},
            )
            assert resp.status_code == 200, resp.text

        assert _titles(db, target.id) == ["Tickets"]

    def test_copying_from_an_empty_flow_empties_the_target(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        empty = _make_flow(db, popup, slug=f"empty-{uuid.uuid4().hex[:6]}")
        target = _make_flow(db, popup, slug=f"tgt3-{uuid.uuid4().hex[:6]}")
        _make_step(db, popup, target, title="Will be replaced")

        resp = client.post(
            f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(empty.id)},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["steps"] == 0
        assert _titles(db, target.id) == []

    def test_a_source_from_another_popup_is_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        other_popup = _make_popup(db, tenant_a)
        target = _make_flow(db, popup, slug=f"tgt4-{uuid.uuid4().hex[:6]}")
        foreign = _make_flow(db, other_popup, slug=f"foreign-{uuid.uuid4().hex[:6]}")
        _make_step(db, popup, target, title="Untouched")

        resp = client.post(
            f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(foreign.id)},
        )

        assert resp.status_code == 404, resp.text
        assert _titles(db, target.id) == ["Untouched"], (
            "a rejected copy must not have deleted the target's steps"
        )

    def test_a_source_with_a_different_type_is_rejected_without_mutation(
        self, client: TestClient, db: Session, tenant_a: Tenants, admin_token_tenant_a
    ) -> None:
        popup = _make_popup(db, tenant_a)
        source = _make_flow(
            db,
            popup,
            slug=f"application-{uuid.uuid4().hex[:6]}",
            flow_type="application",
        )
        target = _make_flow(db, popup, slug=f"direct-{uuid.uuid4().hex[:6]}")
        _make_step(db, popup, target, title="Untouched")

        resp = client.post(
            f"/api/v1/ticketing-steps/copy-to-flow/{target.id}",
            headers=_headers(admin_token_tenant_a),
            json={"source_flow_id": str(source.id)},
        )

        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"] == (
            "Source sales flow must have the same type as the target flow"
        )
        assert _titles(db, target.id) == ["Untouched"]
