"""E2E tests for attendee creation enforcement via category rules.

Spec scenarios covered (W4 from verify-report):
- max-per-application-enforced: second attendee in capped category returns 400
- category_disabled: enabled_in_passes_flow=false returns 422
- create-attendee-invalid-category-rejected: category from different popup returns 422

All tests use real HTTP calls via TestClient so router-level validation is exercised
end-to-end. Popups are created via the API (so main category is auto-seeded); humans
and applications are seeded directly via db.add for speed.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _human_auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"cat-enforcement-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_accepted_application(
    db: Session,
    tenant: Tenants,
    popup_id: uuid.UUID,
    human: Humans,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup_id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _create_popup_via_api(client: TestClient, admin_token: str) -> dict:
    """Create a popup via the API so main category is auto-seeded."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token),
        json={"name": f"Enforcement Test Popup {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _get_main_category(client: TestClient, admin_token: str, popup_id: str) -> dict:
    """Fetch the main (primary) category for a popup."""
    resp = client.get(
        f"/api/v1/popups/{popup_id}/attendee-categories",
        headers=_admin_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text
    cats = resp.json()["results"]
    main = [c for c in cats if c["is_primary"]]
    assert main, f"No main category found for popup {popup_id}"
    return main[0]


def _create_capped_category(
    client: TestClient,
    admin_token: str,
    popup_id: str,
    *,
    max_per_application: int = 1,
) -> dict:
    """Create a non-primary category with a max_per_application cap."""
    unique = uuid.uuid4().hex[:6]
    resp = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token),
        json={
            "popup_id": popup_id,
            "key": f"capped_{unique}",
            "max_per_application": max_per_application,
            "enabled_in_passes_flow": True,
            "required_fields": [],
            "display_meta": {"label": "Capped Category"},
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_disabled_category(
    client: TestClient,
    admin_token: str,
    popup_id: str,
) -> dict:
    """Create a non-primary category with enabled_in_passes_flow=False."""
    unique = uuid.uuid4().hex[:6]
    resp = client.post(
        "/api/v1/attendee-categories",
        headers=_admin_headers(admin_token),
        json={
            "popup_id": popup_id,
            "key": f"disabled_{unique}",
            "enabled_in_passes_flow": False,
            "required_fields": [],
            "display_meta": {"label": "Disabled Category"},
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _post_attendee(
    client: TestClient,
    human: Humans,
    popup_id: str,
    category_id: str,
    *,
    name: str = "Test Attendee",
):  # type: ignore[no-untyped-def]
    return client.post(
        f"/api/v1/attendees/my/popup/{popup_id}",
        headers=_human_auth(human),
        json={"name": name, "category_id": category_id},
    )


# ---------------------------------------------------------------------------
# Scenario: max-per-application-enforced
# ---------------------------------------------------------------------------


class TestMaxPerApplicationEnforced:
    """A second attendee in a capped category must return 400 or 422."""

    def test_first_attendee_succeeds_second_is_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """With max_per_application=1, first creation succeeds; second returns 422 max_reached."""
        popup = _create_popup_via_api(client, admin_token_tenant_a)
        popup_id = popup["id"]

        capped_cat = _create_capped_category(
            client, admin_token_tenant_a, popup_id, max_per_application=1
        )
        cat_id = capped_cat["id"]

        human = _make_human(db, tenant_a, suffix="maxcap")
        _make_accepted_application(db, tenant_a, uuid.UUID(popup_id), human)

        # First attendee succeeds
        resp1 = _post_attendee(client, human, popup_id, cat_id, name="First")
        assert resp1.status_code == 200, (
            f"Expected 200 on first creation, got {resp1.status_code}: {resp1.text}"
        )

        # Second attendee in same category must fail
        resp2 = _post_attendee(client, human, popup_id, cat_id, name="Second")
        assert resp2.status_code == 422, (
            f"Expected 422 on second creation, got {resp2.status_code}: {resp2.text}"
        )
        detail = resp2.json().get("detail", [])
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "max_reached" in codes, f"Expected 'max_reached' code, got: {codes}"


# ---------------------------------------------------------------------------
# Scenario: category_disabled (enabled_in_passes_flow=false)
# ---------------------------------------------------------------------------


class TestCategoryDisabledEnforced:
    """Creating an attendee in a category with enabled_in_passes_flow=false must return 422."""

    def test_disabled_category_returns_422(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """POST /attendees/my/popup/{popup_id} with disabled category → 422 category_disabled."""
        popup = _create_popup_via_api(client, admin_token_tenant_a)
        popup_id = popup["id"]

        disabled_cat = _create_disabled_category(client, admin_token_tenant_a, popup_id)
        cat_id = disabled_cat["id"]

        human = _make_human(db, tenant_a, suffix="disabled")
        _make_accepted_application(db, tenant_a, uuid.UUID(popup_id), human)

        resp = _post_attendee(client, human, popup_id, cat_id)
        assert resp.status_code == 422, (
            f"Expected 422, got {resp.status_code}: {resp.text}"
        )
        detail = resp.json().get("detail", [])
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "category_disabled" in codes, (
            f"Expected 'category_disabled' code, got: {codes}"
        )


# ---------------------------------------------------------------------------
# Scenario: create-attendee-invalid-category-rejected (wrong popup)
# ---------------------------------------------------------------------------


class TestCategoryFromDifferentPopupRejected:
    """A category_id that belongs to a different popup must be rejected with 422."""

    def test_cross_popup_category_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """category_id from popup B used when creating attendee in popup A → 422 invalid_category."""
        popup_a = _create_popup_via_api(client, admin_token_tenant_a)
        popup_b = _create_popup_via_api(client, admin_token_tenant_a)

        popup_a_id = popup_a["id"]
        popup_b_id = popup_b["id"]

        # Get main category of popup B — this is the "wrong popup" category
        cat_b = _get_main_category(client, admin_token_tenant_a, popup_b_id)
        cat_b_id = cat_b["id"]

        human = _make_human(db, tenant_a, suffix="wrongpopup")
        # Human has an accepted application in popup A, NOT popup B
        _make_accepted_application(db, tenant_a, uuid.UUID(popup_a_id), human)

        # Try to create attendee in popup A using popup B's category
        resp = _post_attendee(client, human, popup_a_id, cat_b_id)
        assert resp.status_code == 422, (
            f"Expected 422, got {resp.status_code}: {resp.text}"
        )
        detail = resp.json().get("detail", [])
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "invalid_category" in codes, (
            f"Expected 'invalid_category' code, got: {codes}"
        )
