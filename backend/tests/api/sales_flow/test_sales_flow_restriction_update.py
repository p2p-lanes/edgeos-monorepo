"""Task 12.x — `restriction_rule` mutation surface on SalesFlowCreate/Update.

Design: sdd/sales-flows D5/D6, G3 checkpoint 12.8 CONFIRMED 2026-08-04.
Structural validation (closed predicate/op set) + the direct-flow
`human_profile_field` save-time guard (anonymous buyers have no Humans row).

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient

from app.api.popup.models import Popups


def _create_payload(popup_id: uuid.UUID, **overrides: object) -> dict:
    payload = {
        "popup_id": str(popup_id),
        "slug": f"flow-{uuid.uuid4().hex[:8]}",
        "name": "Test Flow",
    }
    payload.update(overrides)
    return payload


_VALID_RULE = {
    "all_of": [
        {"kind": "form_answer", "field_name": "country", "op": "eq", "value": "AR"}
    ]
}

_HUMAN_FIELD_RULE = {
    "kind": "human_profile_field",
    "field": "email",
    "op": "exists",
}

_MALFORMED_RULE = {"kind": "arbitrary_sql", "op": "eq"}


class TestSalesFlowCreateRestrictionRule:
    def test_create_with_null_restriction_rule_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        assert response.status_code == 201
        assert response.json()["restriction_rule"] is None

    def test_create_with_valid_restriction_rule_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id, type="application", restriction_rule=_VALID_RULE
            ),
        )
        assert response.status_code == 201
        assert response.json()["restriction_rule"] == _VALID_RULE

    def test_create_with_malformed_restriction_rule_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, restriction_rule=_MALFORMED_RULE),
        )
        assert response.status_code == 422

    def test_create_direct_flow_with_human_profile_field_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """A type=direct flow has no Humans row for an anonymous buyer —
        human_profile_field would be unresolvable and, under fail-closed,
        block every buyer. Rejected at save time."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id,
                type="direct",
                restriction_rule=_HUMAN_FIELD_RULE,
            ),
        )
        assert response.status_code == 422

    def test_create_application_flow_with_human_profile_field_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Sanity: the guard is direct-type only."""
        response = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id,
                type="application",
                restriction_rule=_HUMAN_FIELD_RULE,
            ),
        )
        assert response.status_code == 201


class TestSalesFlowUpdateRestrictionRule:
    def test_update_sets_valid_restriction_rule(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, type="application"),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"restriction_rule": _VALID_RULE},
        )
        assert response.status_code == 200
        assert response.json()["restriction_rule"] == _VALID_RULE

    def test_update_clears_restriction_rule_to_null(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id, type="application", restriction_rule=_VALID_RULE
            ),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"restriction_rule": None},
        )
        assert response.status_code == 200
        assert response.json()["restriction_rule"] is None

    def test_update_omitting_restriction_rule_leaves_it_unchanged(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id, type="application", restriction_rule=_VALID_RULE
            ),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"name": "Renamed"},
        )
        assert response.status_code == 200
        assert response.json()["restriction_rule"] == _VALID_RULE

    def test_update_with_malformed_restriction_rule_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"restriction_rule": _MALFORMED_RULE},
        )
        assert response.status_code == 422

    def test_update_direct_flow_with_human_profile_field_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(popup_tenant_a.id, type="direct"),
        )
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"restriction_rule": _HUMAN_FIELD_RULE},
        )
        assert response.status_code == 422

    def test_flipping_type_to_direct_revalidates_existing_rule(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """A previously-valid human_profile_field rule on an application-type
        flow becomes invalid the moment the flow's type flips to direct —
        even if this specific PATCH doesn't touch restriction_rule at all."""
        create = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json=_create_payload(
                popup_tenant_a.id,
                type="application",
                restriction_rule=_HUMAN_FIELD_RULE,
            ),
        )
        assert create.status_code == 201
        flow_id = create.json()["id"]

        response = client.patch(
            f"/api/v1/sales-flows/{flow_id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"type": "direct"},
        )
        assert response.status_code == 422
