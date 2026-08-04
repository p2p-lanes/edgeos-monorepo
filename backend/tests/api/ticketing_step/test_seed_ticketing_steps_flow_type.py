"""Tests for the per-flow-type buyer-step seeding gate
(sdd/sales-flows slice 8).

`seed_ticketing_steps_for_popup`'s `_direct_sale_only` gate migrates from
reading `popup.sale_type` to reading a sales flow's own `type` — a
same-value read-source swap today (the default flow's `type` is always
provisioned equal to `popup.sale_type`, task 5.0), proven end-to-end
through the real `POST /popups` creation path.
"""

import uuid

from fastapi.testclient import TestClient

from app.api.sales_flow.crud import sales_flows_crud
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.ticketing_step.crud import ticketing_steps_crud


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestSeedTicketingStepsForPopupFlowTypeGate:
    def test_direct_flow_type_includes_buyer_step(self, db) -> None:
        popup_id = uuid.uuid4()

        # Use a real tenant/popup pair via a lightweight direct DB seed to
        # avoid duplicating the full popup-creation transaction here.
        from app.api.popup.models import Popups
        from app.api.tenant.models import Tenants

        tenant = Tenants(
            name=f"Seed Test {uuid.uuid4().hex[:8]}",
            slug=f"seed-test-{uuid.uuid4().hex[:8]}",
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)

        popup = Popups(
            id=popup_id,
            tenant_id=tenant.id,
            name="Direct Seed Test",
            slug=f"direct-seed-test-{popup_id.hex[:8]}",
            sale_type="direct",
        )
        db.add(popup)
        db.commit()

        seed_ticketing_steps_for_popup(
            db, popup_id=popup.id, tenant_id=tenant.id, flow_type="direct"
        )

        steps, _ = ticketing_steps_crud.find_by_popup(db, popup.id)
        assert "buyer" in [s.step_type for s in steps]

    def test_application_flow_type_excludes_buyer_step(self, db) -> None:
        from app.api.popup.models import Popups
        from app.api.tenant.models import Tenants

        tenant = Tenants(
            name=f"Seed Test {uuid.uuid4().hex[:8]}",
            slug=f"seed-test-{uuid.uuid4().hex[:8]}",
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)

        popup = Popups(
            tenant_id=tenant.id,
            name="Application Seed Test",
            slug=f"application-seed-test-{uuid.uuid4().hex[:8]}",
            sale_type="application",
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)

        seed_ticketing_steps_for_popup(
            db, popup_id=popup.id, tenant_id=tenant.id, flow_type="application"
        )

        steps, _ = ticketing_steps_crud.find_by_popup(db, popup.id)
        assert "buyer" not in [s.step_type for s in steps]


class TestPopupCreationSeedsThroughDefaultFlowType:
    """End-to-end: POST /popups resolves the buyer-step gate through the
    auto-provisioned default flow's `type`, not `popup.sale_type` directly
    (same observable result today — task 5.0 provisions the default flow
    with `type=popup.sale_type` — but the read source has moved)."""

    def test_direct_sale_popup_creation_seeds_buyer_step(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        resp = client.post(
            "/api/v1/popups",
            headers=_headers(admin_token_tenant_a),
            json={
                "name": f"Direct Popup {uuid.uuid4().hex[:8]}",
                "sale_type": "direct",
            },
        )
        assert resp.status_code == 201, resp.text
        popup_id = uuid.UUID(resp.json()["id"])

        steps_resp = client.get(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup_id)},
        )
        assert steps_resp.status_code == 200
        step_types = [s["step_type"] for s in steps_resp.json()["results"]]
        assert "buyer" in step_types

    def test_application_popup_creation_excludes_buyer_step(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        resp = client.post(
            "/api/v1/popups",
            headers=_headers(admin_token_tenant_a),
            json={
                "name": f"Application Popup {uuid.uuid4().hex[:8]}",
                "sale_type": "application",
            },
        )
        assert resp.status_code == 201, resp.text
        popup_id = uuid.UUID(resp.json()["id"])

        steps_resp = client.get(
            "/api/v1/ticketing-steps",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup_id)},
        )
        assert steps_resp.status_code == 200
        step_types = [s["step_type"] for s in steps_resp.json()["results"]]
        assert "buyer" not in step_types

    def test_default_flow_type_matches_popup_sale_type_at_creation(
        self, client: TestClient, db, admin_token_tenant_a: str
    ) -> None:
        resp = client.post(
            "/api/v1/popups",
            headers=_headers(admin_token_tenant_a),
            json={
                "name": f"Direct Popup Flow Type {uuid.uuid4().hex[:8]}",
                "sale_type": "direct",
            },
        )
        assert resp.status_code == 201, resp.text
        popup_id = uuid.UUID(resp.json()["id"])

        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        assert default_flow is not None
        assert default_flow.type == "direct"
