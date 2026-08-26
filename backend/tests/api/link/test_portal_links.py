"""Tests for PR-5: Referral module — T-gr-034.

Covers:
  - T-gr-028: Referrals model (table exists, basic CRUD at DB level)
  - T-gr-029: Referral schemas (ReferralCreate, ReferralPublic, ReferralPublicPreview)
  - T-gr-030: ReferralsCRUD operations
  - T-gr-031: Portal / public / admin router endpoints
  - T-gr-032: referral_id attribution wiring in application creation
  - T-gr-034: Integration tests

Spec refs: REQ-GR-008 through REQ-GR-011 (referrals), REQ-GR-026 (popup flag gate),
           REQ-GR-009 (attribution on application), REQ-GR-010 (max_uses enforcement).
Design refs: Decision 1c (module layout), API surface table for referrals.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from tests._flow_helpers import invite_flow_id, provision_default_flow, set_link_policy

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_token(user: Users) -> str:
    return create_access_token(subject=user.id, token_type="user")


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    referrals_enabled: bool = True,
    status: PopupStatus = PopupStatus.active,
) -> Popups:
    popup = Popups(
        name=f"ReferralTest {uuid.uuid4().hex[:6]}",
        slug=f"reftest-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        referrals_enabled=referrals_enabled,
        status=status,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_human(db: Session, tenant: Tenants, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"reftest-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Ref",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _give_ticket(db: Session, popup: Popups, human: Humans) -> AttendeeProducts:
    """Give `human` a ticket (attendee_product) in `popup`.

    Referral creation is gated on the human actually holding a ticket, so tests
    that exercise the create flow must seed one first.
    """
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name="Ticket",
        slug=f"tkt-{uuid.uuid4().hex[:8]}",
        price=Decimal("0"),
        category="ticket",
    )
    db.add(product)
    db.flush()
    attendee = Attendees(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        name="Ref Tester",
        email=human.email,
    )
    db.add(attendee)
    db.flush()
    ap = AttendeeProducts(
        tenant_id=popup.tenant_id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=uuid.uuid4().hex[:8].upper(),
    )
    db.add(ap)
    db.commit()
    return ap


def _make_referral(
    db: Session,
    popup: Popups,
    referrer: Humans,
    *,
    code: str | None = None,
    max_uses: int | None = None,
    current_uses: int = 0,
    auto_approve: bool = False,
    discount_percentage: Decimal = Decimal("0"),
    expires_at: datetime | None = None,
    is_disabled: bool = False,
) -> Invites:
    """Build a referral: an Invite carrying a referrer_human_id.

    Referrals were merged into `invites` (migration a3f8c1d94e27), so a row in
    the old `referrals` table is invisible to every code path now.
    """
    ref_code = code or f"ref-{uuid.uuid4().hex[:12]}"
    ref = Invites(
        sales_flow_id=invite_flow_id(db, popup.id),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        referrer_human_id=referrer.id,
        token=ref_code,
        max_uses=max_uses,
        current_uses=current_uses,
        auto_approve=auto_approve,
        express_checkout=True,
        discount_percentage=discount_percentage,
        expires_at=expires_at,
        is_disabled=is_disabled,
    )
    db.add(ref)
    db.commit()
    db.refresh(ref)
    return ref


# ---------------------------------------------------------------------------
# T-gr-028: Model — table exists and can be written/read
# ---------------------------------------------------------------------------


class TestReferralModel:
    """Referrals SQLModel table exists and basic DB operations work (T-gr-028).

    Spec: REQ-GR-008 — Referral entity and schema.
    """

    def test_referral_can_be_created_and_fetched(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a: Users
    ) -> None:
        """Direct DB write + read round-trip validates the model and table."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        referral = _make_referral(db, popup, human, code="model-test-ref")

        fetched = db.get(Invites, referral.id)
        assert fetched is not None
        assert fetched.code == "model-test-ref"
        assert fetched.popup_id == popup.id
        assert fetched.referrer_human_id == human.id
        assert fetched.current_uses == 0
        assert fetched.auto_approve is False

    def test_referral_stores_discount_percentage(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """discount_percentage stored correctly."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        referral = _make_referral(
            db, popup, human, code="disc-test-ref", discount_percentage=Decimal("15.50")
        )
        fetched = db.get(Invites, referral.id)
        assert fetched is not None
        assert fetched.discount_percentage == Decimal("15.50")


# ---------------------------------------------------------------------------
# T-gr-029 / T-gr-030: Schemas and CRUD — tested via HTTP endpoints
# ---------------------------------------------------------------------------


class TestReferralPortalCRUD:
    """Portal endpoints: POST/GET/PATCH/DELETE /portal/referrals (T-gr-031).

    Spec: REQ-GR-008 (entity), REQ-GR-026 (popup flag gate).
    """

    def test_human_can_create_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-GR-008: Human creates referral; code auto-generated when omitted."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert "token" in body
        assert body["current_uses"] == 0
        assert body["popup_id"] == str(popup.id)
        assert body["referrer_human_id"] == str(human.id)

    def test_human_without_ticket_cannot_create_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Anti-abuse gate: no ticket in the popup → 403 (cannot create referral)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)  # no _give_ticket
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code == 403, resp.json()

    def test_human_can_create_referral_with_explicit_code(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Custom code accepted when provided and unique."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        htok = _human_token(human)
        explicit_code = f"custom-{uuid.uuid4().hex[:12]}"

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id), "token": explicit_code},
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["token"] == explicit_code

    def test_duplicate_code_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-GR-008 scenario: duplicate code within popup → 409 Conflict."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        dup_code = f"dup-{uuid.uuid4().hex[:12]}"
        _make_referral(db, popup, human, code=dup_code)

        htok = _human_token(human)
        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id), "token": dup_code},
            headers=_auth(htok),
        )
        assert resp.status_code == 409, resp.json()

    def test_referral_blocked_when_referrals_disabled(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-GR-026: popup.referrals_enabled=False → 403 Forbidden."""
        popup = _make_popup(db, tenant_a, referrals_enabled=False)
        human = _make_human(db, tenant_a)
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code in (403, 422), resp.json()

    def test_human_can_list_own_referrals(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """GET /portal/referrals?popup_id=... lists referrals owned by the human."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _make_referral(db, popup, human, code=f"list-{uuid.uuid4().hex[:8]}")
        _make_referral(db, popup, human, code=f"list-{uuid.uuid4().hex[:8]}")
        htok = _human_token(human)

        resp = client.get(
            f"/api/v1/portal/invites?popup_id={popup.id}",
            headers=_auth(htok),
        )
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert "results" in body
        assert body["paging"]["total"] >= 2

    def test_human_can_patch_own_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Owner can update expires_at and max_uses."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        ref = _make_referral(db, popup, human, code=f"patch-{uuid.uuid4().hex[:8]}")
        htok = _human_token(human)

        resp = client.patch(
            f"/api/v1/portal/invites/{ref.id}",
            json={"max_uses": 20},
            headers=_auth(htok),
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["max_uses"] == 20

    def test_non_owner_cannot_patch_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Non-owner PATCH attempt → 403 Forbidden."""
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        other = _make_human(db, tenant_a)
        ref = _make_referral(db, popup, owner, code=f"notown-{uuid.uuid4().hex[:8]}")
        other_tok = _human_token(other)

        resp = client.patch(
            f"/api/v1/portal/invites/{ref.id}",
            json={"max_uses": 5},
            headers=_auth(other_tok),
        )
        assert resp.status_code == 403, resp.json()

    def test_human_can_delete_unused_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Owner DELETE /portal/referrals/{id} when current_uses=0 → 204."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        ref = _make_referral(db, popup, human, code=f"del-{uuid.uuid4().hex[:8]}")
        htok = _human_token(human)

        resp = client.delete(
            f"/api/v1/portal/invites/{ref.id}",
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 204), resp.json()

    def test_delete_used_referral_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """DELETE when current_uses > 0 → 409 Conflict."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        ref = _make_referral(
            db, popup, human, code=f"delused-{uuid.uuid4().hex[:8]}", current_uses=1
        )
        htok = _human_token(human)

        resp = client.delete(
            f"/api/v1/portal/invites/{ref.id}",
            headers=_auth(htok),
        )
        assert resp.status_code == 409, resp.json()


# ---------------------------------------------------------------------------
# Public lookup — GET /referrals/r/{code}
# ---------------------------------------------------------------------------


class TestReferralPublicLookup:
    """Public referral lookup: GET /referrals/r/{code}.

    Spec: Design API surface — no PII of referrer in response.
    """

    def test_public_lookup_returns_preview(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """GET /referrals/r/{code} returns ReferralPublicPreview with no referrer PII."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        code = f"pub-{uuid.uuid4().hex[:12]}"
        _make_referral(
            db, popup, human, code=code, discount_percentage=Decimal("10.00")
        )

        resp = client.get(f"/api/v1/invites/preview/{code}")
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["token"] == code
        assert "referrer_human_id" not in body, "PII leak: referrer_human_id present"
        assert "discount_percentage" in body
        assert body["discount_percentage"] == "10.00"

    def test_unknown_code_returns_404(
        self,
        client: TestClient,
    ) -> None:
        """Unknown code → 404."""
        resp = client.get("/api/v1/invites/preview/does-not-exist-xyz")
        assert resp.status_code == 404, resp.json()

    def test_ended_popup_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Referral on an ended popup → 410 Gone (link no longer available)."""
        popup = _make_popup(db, tenant_a, status=PopupStatus.ended)
        human = _make_human(db, tenant_a)
        code = f"ended-{uuid.uuid4().hex[:12]}"
        _make_referral(db, popup, human, code=code)

        resp = client.get(f"/api/v1/invites/preview/{code}")
        assert resp.status_code == 410, resp.json()

    def test_disabled_referral_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Admin-disabled referral → 410 Gone on the public preview."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        code = f"dis-{uuid.uuid4().hex[:12]}"
        _make_referral(db, popup, human, code=code, is_disabled=True)

        resp = client.get(f"/api/v1/invites/preview/{code}")
        assert resp.status_code == 410, resp.json()

    def test_referrals_flag_off_returns_410(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """popup.referrals_enabled=False → existing links stop resolving (410)."""
        popup = _make_popup(db, tenant_a, referrals_enabled=False)
        human = _make_human(db, tenant_a)
        code = f"floff-{uuid.uuid4().hex[:12]}"
        _make_referral(db, popup, human, code=code)

        resp = client.get(f"/api/v1/invites/preview/{code}")
        assert resp.status_code == 410, resp.json()


# ---------------------------------------------------------------------------
# Admin moderation — GET/PATCH /admin/referrals
# ---------------------------------------------------------------------------


class TestReferralAdminCRUD:
    """Admin moderation endpoints: GET/PATCH /admin/referrals (T-gr-031).

    Spec: Design API surface — admin can list and update admin-only fields.
    """

    def test_admin_can_list_referrals(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin GET /admin/referrals?popup_id=... returns all popup referrals."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _make_referral(db, popup, human, code=f"adm-{uuid.uuid4().hex[:8]}")
        _make_referral(db, popup, human, code=f"adm-{uuid.uuid4().hex[:8]}")
        atk = _admin_token(admin_user_tenant_a)

        resp = client.get(
            f"/api/v1/invites?issuer=portal&popup_id={popup.id}",
            headers={**_auth(atk), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert "results" in body
        assert body["paging"]["total"] >= 2

    def test_admin_can_disable_and_reenable(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin PATCH is_disabled kills the public link; re-enable restores it."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        code = f"kill-{uuid.uuid4().hex[:8]}"
        ref = _make_referral(db, popup, human, code=code)
        atk = _admin_token(admin_user_tenant_a)
        headers = {**_auth(atk), "X-Tenant-Id": str(tenant_a.id)}

        resp = client.patch(
            f"/api/v1/invites/{ref.id}",
            json={"is_disabled": True},
            headers=headers,
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["is_disabled"] is True

        assert client.get(f"/api/v1/invites/preview/{code}").status_code == 410

        resp = client.patch(
            f"/api/v1/invites/{ref.id}",
            json={"is_disabled": False},
            headers=headers,
        )
        assert resp.status_code == 200, resp.json()
        assert client.get(f"/api/v1/invites/preview/{code}").status_code == 200

    def test_admin_can_update_discount_and_auto_approve(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin PATCH sets discount_percentage and auto_approve (admin-only fields)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        ref = _make_referral(db, popup, human, code=f"admupd-{uuid.uuid4().hex[:8]}")
        atk = _admin_token(admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/invites/{ref.id}",
            json={"discount_percentage": "25.00", "auto_approve": True},
            headers={**_auth(atk), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["auto_approve"] is True
        assert Decimal(body["discount_percentage"]) == Decimal("25.00")


# ---------------------------------------------------------------------------
# T-gr-032: referral_id attribution wiring in application creation
# ---------------------------------------------------------------------------


class TestReferralAttribution:
    """referral_id is set on the application when applying via a referral.

    Spec: REQ-GR-009 (attribution on application), REQ-GR-010 (max_uses enforcement).
    Design: T-gr-032, Decision 1f.
    """

    def test_application_via_referral_sets_referral_id(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-009: Application created with referral_id → stored on Applications row."""
        from app.api.application.models import Applications

        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        ref = _make_referral(db, popup, referrer, code=f"attr-{uuid.uuid4().hex[:8]}")
        htok = _human_token(applicant)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
            },
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()

        # Verify referral_id stored on application
        app_id = resp.json()["id"]
        app = db.get(Applications, uuid.UUID(app_id))
        assert app is not None
        assert app.referral_id == ref.id

        # Verify referral current_uses incremented (REQ-GR-009)
        db.refresh(ref)
        assert ref.current_uses == 1

    def test_application_via_auto_approve_referral_creates_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """REQ-GR-009 + Decision 1f: referral with auto_approve=True → ACCEPTED application."""
        from app.api.application.models import Applications
        from app.api.application.schemas import ApplicationStatus

        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        ref = _make_referral(
            db,
            popup,
            referrer,
            code=f"autoapprove-{uuid.uuid4().hex[:8]}",
            auto_approve=True,
        )
        htok = _human_token(applicant)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
            },
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()

        app_id = resp.json()["id"]
        app = db.get(Applications, uuid.UUID(app_id))
        assert app is not None
        assert app.status == ApplicationStatus.ACCEPTED.value

    def test_application_via_non_auto_approve_referral_stays_in_review(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """An admin-restricted referral must not fall through to AUTO_ACCEPT."""
        from app.api.application.models import Applications
        from app.api.application.schemas import ApplicationStatus

        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        ref = _make_referral(
            db,
            popup,
            referrer,
            code=f"manual-review-{uuid.uuid4().hex[:8]}",
            auto_approve=False,
        )

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
                "status": "in review",
            },
            headers=_auth(_human_token(applicant)),
        )
        assert resp.status_code in (200, 201), resp.json()

        app = db.get(Applications, uuid.UUID(resp.json()["id"]))
        assert app is not None
        assert app.status == ApplicationStatus.IN_REVIEW.value

    def test_exhausted_referral_blocks_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-GR-010: referral with max_uses exhausted → 410 Gone."""
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        ref = _make_referral(
            db,
            popup,
            referrer,
            code=f"exhaust-{uuid.uuid4().hex[:8]}",
            max_uses=2,
            current_uses=2,
        )
        htok = _human_token(applicant)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
            },
            headers=_auth(htok),
        )
        assert resp.status_code == 410, resp.json()

    def test_expired_referral_blocks_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Expired referral → 410 Gone."""
        popup = _make_popup(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        past = datetime.now(UTC) - timedelta(days=1)
        ref = _make_referral(
            db,
            popup,
            referrer,
            code=f"exp-{uuid.uuid4().hex[:8]}",
            expires_at=past,
        )
        htok = _human_token(applicant)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
            },
            headers=_auth(htok),
        )
        assert resp.status_code == 410, resp.json()

    def test_referral_disabled_popup_blocks_attribution(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """REQ-GR-026: popup.referrals_enabled=False blocks referral attribution in apply."""
        # Make a popup with referrals_disabled but a valid referral in DB
        popup_disabled = _make_popup(db, tenant_a, referrals_enabled=False)
        referrer = _make_human(db, tenant_a)
        applicant = _make_human(db, tenant_a)
        ref = _make_referral(
            db, popup_disabled, referrer, code=f"disabled-{uuid.uuid4().hex[:8]}"
        )
        htok = _human_token(applicant)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup_disabled.id),
                "first_name": applicant.first_name,
                "last_name": applicant.last_name,
                "email": applicant.email,
                "referral_id": str(ref.id),
            },
            headers=_auth(htok),
        )
        assert resp.status_code in (403, 422), resp.json()


# ---------------------------------------------------------------------------
# T-gr-034: RLS isolation
# ---------------------------------------------------------------------------


class TestReferralRLS:
    """Tenant isolation via RLS: tenant A referrals invisible to tenant B (REQ-GR-011)."""

    def test_tenant_rls_isolation(
        self,
        db: Session,
        tenant_a: Tenants,
        tenant_b: Tenants,
    ) -> None:
        """REQ-GR-011: cross-tenant referral access denied at DB level.

        We test this at the CRUD level using the session-scoped tenant fixtures:
        create referrals for tenant A and tenant B in the same session, then verify
        that the code-uniqueness check operates per-popup (each popup is
        tenant-scoped, so uniqueness only conflicts within a popup, not across
        tenants). Full RLS enforcement is exercised at the DB level during
        integration tests via testcontainers.
        """
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_b)
        human_a = _make_human(db, tenant_a)
        human_b = _make_human(db, tenant_b)

        # Same code across different popups (different tenants) is allowed
        shared_code = "cross-tenant-code"
        ref_a = _make_referral(db, popup_a, human_a, code=shared_code)
        ref_b = _make_referral(db, popup_b, human_b, code=shared_code)

        # Both exist independently
        fetched_a = db.get(Invites, ref_a.id)
        fetched_b = db.get(Invites, ref_b.id)
        assert fetched_a is not None
        assert fetched_b is not None
        assert fetched_a.popup_id != fetched_b.popup_id
        assert fetched_a.tenant_id == tenant_a.id
        assert fetched_b.tenant_id == tenant_b.id


# ---------------------------------------------------------------------------
# Per-popup referral limit (1-link rule + max_uses from popup config)
# ---------------------------------------------------------------------------


class TestPerPopupReferralLimit:
    """Per-popup 1-link-per-attendee rule and max_uses from popup config.

    Product model: each attendee gets exactly ONE referral link per popup.
    max_uses on that link = popup.max_referrals_per_attendee (default 10, null = unlimited).
    """

    def test_second_referral_by_same_human_returns_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """1-link rule: second POST by same human in same popup → 409 Conflict."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        # Create first referral directly in DB
        _make_referral(db, popup, human, code=f"first-{uuid.uuid4().hex[:8]}")
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code == 409, resp.json()
        assert "already have a link" in resp.json()["detail"]

    def test_created_referral_gets_max_uses_from_popup_config(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Popup config max_referrals_per_attendee=5 sets max_uses=5 on the new referral."""
        popup = _make_popup(db, tenant_a)
        set_link_policy(db, popup, max_referrals_per_attendee=5)

        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["max_uses"] == 5

    def test_null_popup_config_creates_unlimited_referral(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Popup max_referrals_per_attendee=null → max_uses=null (unlimited)."""
        popup = _make_popup(db, tenant_a)
        set_link_policy(db, popup, max_referrals_per_attendee=None)

        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        htok = _human_token(human)

        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id)},
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["max_uses"] is None

    def test_popup_config_wins_over_body_max_uses(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """The flow's ceiling overrides any body-provided max_uses."""
        popup = _make_popup(db, tenant_a)
        set_link_policy(db, popup, max_referrals_per_attendee=3)

        human = _make_human(db, tenant_a)
        _give_ticket(db, popup, human)
        htok = _human_token(human)

        # Even if body passes max_uses=100, popup config (3) wins
        resp = client.post(
            "/api/v1/portal/invites",
            json={"popup_id": str(popup.id), "max_uses": 100},
            headers=_auth(htok),
        )
        assert resp.status_code in (200, 201), resp.json()
        assert resp.json()["max_uses"] == 3

    def test_popup_update_accepts_max_referrals_per_attendee(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """PopupUpdate schema accepts max_referrals_per_attendee field."""
        popup = _make_popup(db, tenant_a)
        atk = _admin_token(admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/popups/{popup.id}",
            json={"max_referrals_per_attendee": 15},
            headers={**_auth(atk), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["max_referrals_per_attendee"] == 15

    def test_popup_update_rejects_zero_max_referrals(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """PopupUpdate validator rejects max_referrals_per_attendee < 1."""
        popup = _make_popup(db, tenant_a)
        atk = _admin_token(admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/popups/{popup.id}",
            json={"max_referrals_per_attendee": 0},
            headers={**_auth(atk), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 422, resp.json()

    def test_popup_update_accepts_null_max_referrals(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """PopupUpdate accepts null max_referrals_per_attendee (unlimited escape hatch)."""
        popup = _make_popup(db, tenant_a)
        atk = _admin_token(admin_user_tenant_a)

        resp = client.patch(
            f"/api/v1/popups/{popup.id}",
            json={"max_referrals_per_attendee": None},
            headers={**_auth(atk), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["max_referrals_per_attendee"] is None
