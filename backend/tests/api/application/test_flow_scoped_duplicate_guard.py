"""Task 5.2/5.3 — flow-aware duplicate-application guards.

Design: sdd/sales-flows slice 5, human checkpoint G2 (confirmed 2026-08-04):
one application per person PER FLOW. The two duplicate-rejecting guard
sites (`ApplicationsCRUD.create_admin` and the portal
`POST /applications/my` route) now resolve the popup's default sales_flow
and check + persist `sales_flow_id` on the new row, instead of only
checking `(human_id, popup_id)`.

Graceful degradation: popups that bypass `PopupsCRUD.create` (e.g. legacy
fixtures inserting `Popups(...)` directly, common across this test suite)
have no default sales_flow. The guard must fall back to the legacy
popup-level check in that case rather than raising an internal error —
`resolve_flow`'s "missing default is a 500-class invariant breach" rule
(design D2) belongs to the slice-9 resolver for popups reachable through
the real flow-resolution contract, not to this creation-time guard.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_via_api(client: TestClient, admin_token: str) -> str:
    """Fresh popup via the real create path — auto-provisions a default flow
    (task 5.0)."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Flow Guard Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_legacy_popup(db: Session, tenant: Tenants) -> Popups:
    """Popup created by direct ORM insert — bypasses PopupsCRUD.create, so
    it has NO default sales_flow. Mirrors the shape of dozens of
    pre-existing fixtures across this test suite."""
    slug = f"legacy-flow-guard-{uuid.uuid4().hex[:8]}"
    popup = Popups(name=f"Legacy Popup {slug}", slug=slug, tenant_id=tenant.id)
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human_token(db: Session, tenant: Tenants) -> tuple[Humans, str]:
    human = Humans(
        tenant_id=tenant.id,
        email=f"flow-guard-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human, create_access_token(subject=human.id, token_type="human")


class TestPortalDuplicateGuardIsFlowAware:
    def test_second_submission_for_same_flow_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        _human, token = _make_human_token(db, tenant_a)

        first = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": popup_id, "first_name": "Pat", "last_name": "Doe"},
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": popup_id, "first_name": "Pat", "last_name": "Doe"},
        )
        assert second.status_code == 400
        # Preserve the exact substring the portal string-matches on
        # (useCheckoutState.ts:199) to recover the existing-application state.
        assert "already have an application" in second.json()["detail"]

    def test_created_application_persists_default_flow_id(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        _human, token = _make_human_token(db, tenant_a)

        resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": popup_id, "first_name": "Pat", "last_name": "Doe"},
        )
        assert resp.status_code == 201, resp.text
        application_id = uuid.UUID(resp.json()["id"])

        default_flow = db.exec(
            select(SalesFlows).where(
                SalesFlows.popup_id == uuid.UUID(popup_id),
                SalesFlows.is_default == True,  # noqa: E712
            )
        ).one()
        application = db.get(Applications, application_id)
        assert application is not None
        assert application.sales_flow_id == default_flow.id

    def test_legacy_popup_without_default_flow_falls_back_to_popup_level_guard(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Popups that bypass PopupsCRUD.create have no default flow — the
        guard must degrade to the pre-existing popup-level check rather than
        error out."""
        popup = _make_legacy_popup(db, tenant_a)
        _human, token = _make_human_token(db, tenant_a)

        first = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": str(popup.id), "first_name": "Pat", "last_name": "Doe"},
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={"popup_id": str(popup.id), "first_name": "Pat", "last_name": "Doe"},
        )
        assert second.status_code == 400
        assert "already have an application" in second.json()["detail"]


class TestAdminDuplicateGuardIsFlowAware:
    def test_admin_duplicate_application_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        superadmin_token: str,
        tenant_a: Tenants,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        email = f"flow-guard-admin-{uuid.uuid4().hex[:8]}@test.com"
        headers = {**_headers(superadmin_token), "X-Tenant-Id": str(tenant_a.id)}

        first = client.post(
            "/api/v1/applications",
            headers=headers,
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
            },
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/applications",
            headers=headers,
            json={
                "popup_id": popup_id,
                "first_name": "Pat",
                "last_name": "Doe",
                "email": email,
            },
        )
        assert second.status_code == 400
