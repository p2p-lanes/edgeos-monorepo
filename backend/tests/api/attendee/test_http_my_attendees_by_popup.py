"""HTTP integration tests for attendee endpoints — CAP-B and CAP-C.

Phase 4: route-level tests covering the full HTTP stack.

CAP-B: GET /attendees/my/popup/{popup_id}
Scenarios:
1. 401 — no OTP session
2. Empty result when no attendees
3. Application-linked attendees returned with origin=application
4. Direct-sale attendees returned with origin=direct_sale
5. Mixed origins in the same result
6. Pagination: skip=2, limit=1 with 3 attendees
7. limit > 100 → 422
8. Cross-popup isolation (only target popup's attendees)

CAP-C: POST /attendees/my/popup/{popup_id}
Scenarios:
1. 401 — no OTP session
2. Application popup + accepted application → 200, attendee created, origin=application
3. Festival popup (sale_type=direct) → 422, code=application_required
4. Application popup but no application for human → 422, code=application_required

CAP-C: PATCH /attendees/my/popup/{popup_id}/{attendee_id}
Scenarios:
1. 401 — no OTP session
2. Application owner editing companion attendee (OR branch) → 200
3. Attendee's own human_id self-edit (primary branch) → 200
4. attendee_id not found → 404
5. attendee exists but popup_id mismatch → 404
6. unauthorized human (predicate fails) → 404

CAP-C: DELETE /attendees/my/popup/{popup_id}/{attendee_id}
Scenarios:
1. Authorized human deletes attendee → 200, {"ok": true}
2. Unauthorized human → 404
3. Attendee has purchased products → 400, detail contains attendee_has_products
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"http-capbc-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(
    db: Session, tenant: Tenants, *, suffix: str, sale_type: str = SaleType.application.value
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"HTTP-CAPBC Popup {suffix}",
        slug=f"http-capbc-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type=sale_type,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: str = ApplicationStatus.ACCEPTED.value,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_app_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    application: Applications,
    *,
    name: str = "App Attendee",
    category: str = "main",
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category=category,
        check_in_code=f"AB{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_direct_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    name: str = "Direct Attendee",
    category: str = "main",
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category=category,
        check_in_code=f"DB{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_product(db: Session, tenant: Tenants, popup: Popups, *, suffix: str):
    from app.api.product.models import Products

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Test Product {suffix}",
        slug=f"test-prod-bc-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
        category="standard",
    )
    db.add(product)
    db.flush()
    return product


def _add_product_to_attendee(
    db: Session, attendee: Attendees, tenant: Tenants, popup: Popups
) -> None:
    """Give an attendee a purchased product (triggers has_products guard)."""
    product = _make_product(db, tenant, popup, suffix="purchased")
    ap = AttendeeProducts(
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        quantity=1,
    )
    db.add(ap)
    db.commit()


# ---------------------------------------------------------------------------
# CAP-B: GET /attendees/my/popup/{popup_id}
# ---------------------------------------------------------------------------


class TestListMyAttendeesByPopupHttp:
    """HTTP tests for GET /attendees/my/popup/{popup_id} (CAP-B)."""

    def test_no_auth_returns_401(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="b-noauth")
        response = client.get(f"/api/v1/attendees/my/popup/{popup.id}")
        assert response.status_code == 401

    def test_empty_result_when_no_attendees(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Human with no attendees for popup → 200, empty list."""
        popup = _make_popup(db, tenant_a, suffix="b-empty")
        human = _make_human(db, tenant_a, suffix="b-empty")

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(human)
        )

        assert response.status_code == 200
        body = response.json()
        assert body["results"] == []
        assert body["paging"]["total"] == 0

    def test_application_attendees_returned_with_origin(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application-linked attendees appear with origin=application."""
        popup = _make_popup(db, tenant_a, suffix="b-appatt")
        human = _make_human(db, tenant_a, suffix="b-appatt")
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_app_attendee(db, tenant_a, popup, human, app)

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(human)
        )

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 1
        assert len(body["results"]) == 1
        result = body["results"][0]
        assert result["id"] == str(attendee.id)
        assert result["origin"] == "application"

    def test_direct_sale_attendees_returned_with_origin(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Direct-sale attendees appear with origin=direct_sale."""
        popup = _make_popup(db, tenant_a, suffix="b-diratt")
        human = _make_human(db, tenant_a, suffix="b-diratt")
        attendee = _make_direct_attendee(db, tenant_a, popup, human)

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(human)
        )

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 1
        result = body["results"][0]
        assert result["id"] == str(attendee.id)
        assert result["origin"] == "direct_sale"

    def test_mixed_origins_in_result(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Both application-linked and direct-sale attendees in same result."""
        popup = _make_popup(db, tenant_a, suffix="b-mixed")
        human = _make_human(db, tenant_a, suffix="b-mixed")
        app = _make_application(db, tenant_a, popup, human)
        app_att = _make_app_attendee(db, tenant_a, popup, human, app, name="App Side")
        dir_att = _make_direct_attendee(db, tenant_a, popup, human, name="Direct Side")

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}", headers=_auth(human)
        )

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 2
        ids = {r["id"] for r in body["results"]}
        assert str(app_att.id) in ids
        assert str(dir_att.id) in ids
        origins = {r["id"]: r["origin"] for r in body["results"]}
        assert origins[str(app_att.id)] == "application"
        assert origins[str(dir_att.id)] == "direct_sale"

    def test_pagination_skip_and_limit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """skip=2, limit=1 with 3 attendees → 1 result, total=3."""
        popup = _make_popup(db, tenant_a, suffix="b-paged")
        human = _make_human(db, tenant_a, suffix="b-paged")
        app = _make_application(db, tenant_a, popup, human)
        _make_app_attendee(db, tenant_a, popup, human, app, name="A1", category="main")
        _make_app_attendee(db, tenant_a, popup, human, app, name="A2", category="spouse")
        _make_app_attendee(db, tenant_a, popup, human, app, name="A3", category="child")

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}?skip=2&limit=1",
            headers=_auth(human),
        )

        assert response.status_code == 200
        body = response.json()
        assert len(body["results"]) == 1
        assert body["paging"]["offset"] == 2
        assert body["paging"]["limit"] == 1
        assert body["paging"]["total"] == 3

    def test_limit_over_100_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """limit > 100 → 422 validation error."""
        popup = _make_popup(db, tenant_a, suffix="b-maxlim")
        human = _make_human(db, tenant_a, suffix="b-maxlim")

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup.id}?limit=200",
            headers=_auth(human),
        )

        assert response.status_code == 422

    def test_cross_popup_isolation(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Only popup A attendees returned when querying popup A."""
        popup_a = _make_popup(db, tenant_a, suffix="b-isoa")
        popup_b = _make_popup(db, tenant_a, suffix="b-isob")
        human = _make_human(db, tenant_a, suffix="b-iso")

        app_a = _make_application(db, tenant_a, popup_a, human)
        att_a = _make_app_attendee(db, tenant_a, popup_a, human, app_a, name="Popup A")
        # Attendee in popup_b — should NOT appear in popup_a query
        app_b = _make_application(db, tenant_a, popup_b, human)
        _make_app_attendee(db, tenant_a, popup_b, human, app_b, name="Popup B")

        response = client.get(
            f"/api/v1/attendees/my/popup/{popup_a.id}", headers=_auth(human)
        )

        assert response.status_code == 200
        body = response.json()
        ids = [r["id"] for r in body["results"]]
        assert str(att_a.id) in ids
        assert body["paging"]["total"] == 1


# ---------------------------------------------------------------------------
# CAP-C: POST /attendees/my/popup/{popup_id}
# ---------------------------------------------------------------------------


class TestCreateMyAttendeeForPopupHttp:
    """HTTP tests for POST /attendees/my/popup/{popup_id} (CAP-C)."""

    def test_no_auth_returns_401(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="c-post-noauth")
        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            json={"name": "Test", "category": "spouse"},
        )
        assert response.status_code == 401

    def test_application_popup_accepted_creates_attendee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application popup + accepted application → 200, attendee created, origin=application."""
        popup = _make_popup(db, tenant_a, suffix="c-post-ok", sale_type="application")
        human = _make_human(db, tenant_a, suffix="c-post-ok")
        _make_application(db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED.value)

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={"name": "Spouse Person", "category": "spouse"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["name"] == "Spouse Person"
        assert body["category"] == "spouse"
        assert body["origin"] == "application"
        assert body["popup_id"] == str(popup.id)

    def test_direct_popup_returns_422_application_required(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Festival popup (sale_type=direct) → 422 with code=application_required."""
        popup = _make_popup(db, tenant_a, suffix="c-post-direct", sale_type="direct")
        human = _make_human(db, tenant_a, suffix="c-post-direct")

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={"name": "Spouse Person", "category": "spouse"},
        )

        assert response.status_code == 422
        detail = response.json()["detail"]
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "application_required" in codes

    def test_no_application_returns_422_application_required(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application popup but human has no application → 422, code=application_required."""
        popup = _make_popup(db, tenant_a, suffix="c-post-noapp", sale_type="application")
        human = _make_human(db, tenant_a, suffix="c-post-noapp")

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={"name": "Spouse Person", "category": "spouse"},
        )

        assert response.status_code == 422
        detail = response.json()["detail"]
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "application_required" in codes


# ---------------------------------------------------------------------------
# CAP-C: PATCH /attendees/my/popup/{popup_id}/{attendee_id}
# ---------------------------------------------------------------------------


class TestUpdateMyAttendeeForPopupHttp:
    """HTTP tests for PATCH /attendees/my/popup/{popup_id}/{attendee_id} (CAP-C)."""

    def test_no_auth_returns_401(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="c-patch-noauth")
        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{uuid.uuid4()}",
            json={"name": "Updated"},
        )
        assert response.status_code == 401

    def test_application_owner_can_update_companion(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application owner updates companion attendee via OR-branch predicate."""
        popup = _make_popup(db, tenant_a, suffix="c-patch-owner")
        owner = _make_human(db, tenant_a, suffix="c-patch-owner")
        companion = _make_human(db, tenant_a, suffix="c-patch-comp")
        app = _make_application(db, tenant_a, popup, owner, status=ApplicationStatus.ACCEPTED.value)

        # Create companion attendee: application belongs to owner, but attendee.human_id is companion
        attendee = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            application_id=app.id,
            popup_id=popup.id,
            human_id=companion.id,
            name="Companion Original",
            category="spouse",
            check_in_code=f"CO{uuid.uuid4().hex[:4].upper()}",
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

        # Owner edits companion's name via OR-branch (attendee.application.human_id == owner.id)
        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(owner),
            json={"name": "Companion Updated"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["name"] == "Companion Updated"

    def test_attendee_own_human_id_can_self_edit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Companion's own human_id can edit their own attendee (primary branch)."""
        popup = _make_popup(db, tenant_a, suffix="c-patch-self")
        owner = _make_human(db, tenant_a, suffix="c-patch-self-owner")
        companion = _make_human(db, tenant_a, suffix="c-patch-self-comp")
        app = _make_application(db, tenant_a, popup, owner, status=ApplicationStatus.ACCEPTED.value)

        attendee = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            application_id=app.id,
            popup_id=popup.id,
            human_id=companion.id,
            name="Companion Self Original",
            category="spouse",
            check_in_code=f"CS{uuid.uuid4().hex[:4].upper()}",
        )
        db.add(attendee)
        db.commit()
        db.refresh(attendee)

        # Companion edits their own record (attendee.human_id == companion.id)
        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(companion),
            json={"name": "Companion Self Updated"},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["name"] == "Companion Self Updated"

    def test_nonexistent_attendee_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Attendee that doesn't exist → 404."""
        popup = _make_popup(db, tenant_a, suffix="c-patch-404")
        human = _make_human(db, tenant_a, suffix="c-patch-404")

        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{uuid.uuid4()}",
            headers=_auth(human),
            json={"name": "Nobody"},
        )

        assert response.status_code == 404

    def test_popup_id_mismatch_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Attendee exists but popup_id in path doesn't match → 404."""
        popup_a = _make_popup(db, tenant_a, suffix="c-patch-mma")
        popup_b = _make_popup(db, tenant_a, suffix="c-patch-mmb")
        human = _make_human(db, tenant_a, suffix="c-patch-mm")
        app = _make_application(db, tenant_a, popup_a, human)
        attendee = _make_app_attendee(db, tenant_a, popup_a, human, app)

        # Try to edit attendee using popup_b's ID — should 404
        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup_b.id}/{attendee.id}",
            headers=_auth(human),
            json={"name": "Cross Popup Update"},
        )

        assert response.status_code == 404

    def test_unauthorized_human_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Human who fails the predicate gets 404 (not 403 — do not expose existence)."""
        popup = _make_popup(db, tenant_a, suffix="c-patch-unauth")
        owner = _make_human(db, tenant_a, suffix="c-patch-unauth-owner")
        other_human = _make_human(db, tenant_a, suffix="c-patch-unauth-other")
        app = _make_application(db, tenant_a, popup, owner)
        attendee = _make_app_attendee(db, tenant_a, popup, owner, app)

        # other_human is neither attendee.human_id nor the application owner
        response = client.patch(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(other_human),
            json={"name": "Stolen Update"},
        )

        assert response.status_code == 404


# ---------------------------------------------------------------------------
# CAP-C: DELETE /attendees/my/popup/{popup_id}/{attendee_id}
# ---------------------------------------------------------------------------


class TestDeleteMyAttendeeForPopupHttp:
    """HTTP tests for DELETE /attendees/my/popup/{popup_id}/{attendee_id} (CAP-C)."""

    def test_authorized_human_can_delete(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Authorized human deletes attendee → 200, {"ok": true}."""
        popup = _make_popup(db, tenant_a, suffix="c-del-ok")
        human = _make_human(db, tenant_a, suffix="c-del-ok")
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_app_attendee(db, tenant_a, popup, human, app, name="To Delete")

        response = client.delete(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(human),
        )

        assert response.status_code == 200
        assert response.json() == {"ok": True}

    def test_unauthorized_human_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Unauthorized human attempting delete → 404."""
        popup = _make_popup(db, tenant_a, suffix="c-del-unauth")
        owner = _make_human(db, tenant_a, suffix="c-del-unauth-owner")
        other = _make_human(db, tenant_a, suffix="c-del-unauth-other")
        app = _make_application(db, tenant_a, popup, owner)
        attendee = _make_app_attendee(db, tenant_a, popup, owner, app)

        response = client.delete(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(other),
        )

        assert response.status_code == 404

    def test_attendee_with_products_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Attendee with purchased products → 400."""
        popup = _make_popup(db, tenant_a, suffix="c-del-prod")
        human = _make_human(db, tenant_a, suffix="c-del-prod")
        app = _make_application(db, tenant_a, popup, human)
        attendee = _make_app_attendee(db, tenant_a, popup, human, app, name="Has Products")
        _add_product_to_attendee(db, attendee, tenant_a, popup)

        response = client.delete(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(human),
        )

        assert response.status_code == 400
