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
popup-level check in that case rather than rejecting an optional read path.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import seed_default_steps


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
    seed_default_steps(db, popup)
    return popup


def _seed_flow_applications(
    db: Session,
    tenant: Tenants,
    human: Humans,
    popup: Popups,
    statuses: list[tuple[str, int]],
) -> list[Applications]:
    """One application per (status, days_ago), each on its own flow."""
    now = datetime.now(UTC)
    apps = []
    for i, (status, days_ago) in enumerate(statuses):
        flow = SalesFlows(
            tenant_id=tenant.id,
            popup_id=popup.id,
            slug=f"flow-{i}-{uuid.uuid4().hex[:6]}",
            name=f"Flow {i}",
        )
        db.add(flow)
        db.flush()
        app = Applications(
            tenant_id=tenant.id,
            popup_id=popup.id,
            human_id=human.id,
            sales_flow_id=flow.id,
            status=status,
            submitted_at=now - timedelta(days=days_ago),
        )
        db.add(app)
        apps.append(app)
    db.commit()
    return apps


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


class TestGetByHumanPopupDeterministicOrdering:
    """rel-001: a human can now legitimately hold 2+ applications for one
    popup (one per flow). `get_by_human_popup` must resolve to the same
    row every time: accepted status first, then most recent submission.
    """

    @pytest.mark.parametrize(
        ("statuses", "expected"),
        [
            ([("accepted", 5), ("in review", 0)], 0),  # older accepted still wins
            ([("rejected", 5), ("in review", 0)], 1),  # none accepted: most recent
        ],
    )
    def test_deterministic_selection(
        self,
        db: Session,
        tenant_a: Tenants,
        statuses: list[tuple[str, int]],
        expected: int,
    ) -> None:
        popup = _make_legacy_popup(db, tenant_a)
        human, _ = _make_human_token(db, tenant_a)
        apps = _seed_flow_applications(db, tenant_a, human, popup, statuses)
        result = applications_crud.get_by_human_popup(db, human.id, popup.id)
        assert result is not None
        assert result.id == apps[expected].id

    def test_resolve_popup_access_grants_via_accepted_over_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_legacy_popup(db, tenant_a)
        human, _ = _make_human_token(db, tenant_a)
        _seed_flow_applications(
            db, tenant_a, human, popup, [("rejected", 5), ("accepted", 0)]
        )
        result = applications_crud.resolve_popup_access(db, human.id, popup.id)
        assert result.allowed is True
        assert result.source == "application"
        assert result.application_status == "accepted"
