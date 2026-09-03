"""Changing how an event sells has to reach the door, not just the column.

`sale_type` is still accepted on PATCH, but nothing reads the popup column any
more — every gate asks the flows. A PATCH that wrote the column and left the
default flow alone would be the worst kind of change: the form would show one
thing, every buyer would get the other, and nothing would look broken.

So the value is compared against the default flow's type and applied to it,
including the approved-payment guard that used to protect the column
(sdd/sales-flows-rediseno slice 6).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.sales_flow.crud import sales_flows_crud


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup(client: TestClient, token: str, sale_type: str) -> dict:
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(token),
        json={
            "name": f"Way In {uuid.uuid4().hex[:8]}",
            "sale_type": sale_type,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _default_flow(db: Session, popup_id: str):
    db.expire_all()
    flow = sales_flows_crud.get_default_flow(db, uuid.UUID(popup_id))
    assert flow is not None
    return flow


class TestChangingTheMainWayIn:
    def test_it_retypes_the_default_flow(
        self, client: TestClient, db: Session, admin_token_tenant_a: str
    ) -> None:
        popup = _create_popup(client, admin_token_tenant_a, "application")
        assert _default_flow(db, popup["id"]).type == "application"

        resp = client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )

        assert resp.status_code == 200, resp.text
        assert _default_flow(db, popup["id"]).type == "direct"

    def test_the_door_is_renamed_to_match(
        self, client: TestClient, db: Session, admin_token_tenant_a: str
    ) -> None:
        """A door called "Attendee" that sells tickets is a lie a buyer reads."""
        popup = _create_popup(client, admin_token_tenant_a, "application")
        assert _default_flow(db, popup["id"]).name == "Attendee"

        client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )

        assert _default_flow(db, popup["id"]).name == "Checkout"

    def test_a_door_the_organiser_named_keeps_its_name(
        self, client: TestClient, db: Session, admin_token_tenant_a: str
    ) -> None:
        popup = _create_popup(client, admin_token_tenant_a, "application")
        flow = _default_flow(db, popup["id"])
        flow.name = "General entry"
        db.add(flow)
        db.commit()

        client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )

        renamed = _default_flow(db, popup["id"])
        assert renamed.type == "direct"
        assert renamed.name == "General entry"

    def test_the_derived_flags_follow(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        popup = _create_popup(client, admin_token_tenant_a, "application")

        resp = client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )
        assert resp.status_code == 200, resp.text

        read = client.get(
            f"/api/v1/popups/{popup['id']}", headers=_headers(admin_token_tenant_a)
        ).json()
        assert read["takes_applications"] is False
        assert read["sells_directly"] is True

    def test_resending_the_current_value_changes_nothing(
        self, client: TestClient, db: Session, admin_token_tenant_a: str
    ) -> None:
        """The comparison is against the flow, so a form that echoes back what
        it was given must not count as a change — that is what would trip the
        approved-payment guard on every unrelated save."""
        popup = _create_popup(client, admin_token_tenant_a, "application")
        flow = _default_flow(db, popup["id"])
        flow.name = "General entry"
        db.add(flow)
        db.commit()

        resp = client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"sale_type": "application", "tagline": "unchanged door"},
        )

        assert resp.status_code == 200, resp.text
        unchanged = _default_flow(db, popup["id"])
        assert unchanged.type == "application"
        assert unchanged.name == "General entry"
