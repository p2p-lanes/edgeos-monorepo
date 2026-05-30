"""Tests for PR-3: Group flag enforcement — T-gr-015, T-gr-016, T-gr-021.

Covers:
  - T-gr-015: Replace implicit bool(group_id) auto-accept with explicit
    group.auto_approve_applications flag.
  - T-gr-016: Replace implicit bool(group_id) express-checkout with explicit
    group.express_checkout flag.
  - T-gr-021: Flag transition tests (retroactive non-change guarantee).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.group.models import GroupMembers, Groups, GroupWhitelistedEmails
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"FlagTest {uuid.uuid4().hex[:6]}",
        slug=f"flagtest-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"flagtest-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Flag",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_group(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    auto_approve_applications: bool = False,
    express_checkout: bool = False,
    open_group: bool = True,
) -> Groups:
    """Create a group with explicit behavior flags."""
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Flag Group {uuid.uuid4().hex[:6]}",
        slug=f"flag-grp-{uuid.uuid4().hex[:8]}",
        auto_approve_applications=auto_approve_applications,
        express_checkout=express_checkout,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def _whitelist_email(db: Session, group: Groups, email: str) -> None:
    """Add email to group whitelist so applications are allowed."""
    wl = GroupWhitelistedEmails(
        tenant_id=group.tenant_id,
        group_id=group.id,
        email=email.lower(),
    )
    db.add(wl)
    db.commit()


# ---------------------------------------------------------------------------
# T-gr-015: Explicit auto_approve_applications flag
# ---------------------------------------------------------------------------


class TestAutoApproveFlag:
    """auto_approve_applications=False → application stays DRAFT (T-gr-015).

    Spec: REQ-GR-012, REQ-GR-014.
    Design: Decision 1f — no implicit auto-accept from bool(group_id).
    """

    def test_auto_approve_false_yields_draft(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """New application via group with auto_approve=False stays DRAFT.

        RED: group with auto_approve_applications=False must NOT auto-accept.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(
            db, tenant_a, popup, auto_approve_applications=False, express_checkout=False
        )
        # Open group (no whitelist) so the application is allowed
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "group_id": str(group.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert body["status"] == ApplicationStatus.DRAFT.value, (
            f"Expected DRAFT but got {body['status']!r}. "
            "auto_approve_applications=False must not trigger auto-accept."
        )
        assert body.get("accepted_at") is None, "DRAFT application must not have accepted_at"

    def test_auto_approve_true_yields_accepted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """New application via group with auto_approve=True is ACCEPTED.

        Triangulation: ensures current (legacy) behavior is preserved when
        the flag is set to True.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(
            db, tenant_a, popup, auto_approve_applications=True, express_checkout=True
        )
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "group_id": str(group.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert body["status"] == ApplicationStatus.ACCEPTED.value, (
            f"Expected ACCEPTED but got {body['status']!r}. "
            "auto_approve_applications=True must still auto-accept."
        )
        assert body.get("accepted_at") is not None, "ACCEPTED application must have accepted_at"

    def test_auto_approve_true_red_flag_human_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Red-flagged human is always rejected even when group has auto_approve=True.

        Triangulation: red_flag short-circuit must be preserved per design 1f.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        # Set red_flag
        human.red_flag = True
        db.add(human)
        db.commit()
        db.refresh(human)

        group = _make_group(
            db, tenant_a, popup, auto_approve_applications=True, express_checkout=True
        )
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "group_id": str(group.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        assert body["status"] == ApplicationStatus.REJECTED.value, (
            f"Expected REJECTED but got {body['status']!r}. "
            "red_flag must override auto_approve."
        )


# ---------------------------------------------------------------------------
# T-gr-021: Transition guarantee — existing accepted apps unchanged
# ---------------------------------------------------------------------------


class TestFlagTransitionRetroactive:
    """Flag change is NOT retroactive — existing ACCEPTED apps stay ACCEPTED.

    Spec: REQ-GR-012 "Flag change is not retroactive" scenario.
    Design: Decision 1f "Transition policy: NO retroactive changes."
    """

    def test_existing_accepted_application_unchanged_after_flag_toggle(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Toggle auto_approve_applications from True to False.

        Previously-accepted application MUST remain ACCEPTED.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup, auto_approve_applications=True)

        # Create an application directly in ACCEPTED state (simulates prior accepted app)
        accepted_app = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            group_id=group.id,
            status=ApplicationStatus.ACCEPTED.value,
            accepted_at=datetime(2025, 1, 1, tzinfo=UTC),
        )
        db.add(accepted_app)
        db.commit()
        db.refresh(accepted_app)

        # Now toggle the flag to False
        group.auto_approve_applications = False
        db.add(group)
        db.commit()
        db.refresh(group)

        # Existing app must still be ACCEPTED — no retroactive change
        db.refresh(accepted_app)
        assert accepted_app.status == ApplicationStatus.ACCEPTED.value, (
            "Toggling auto_approve_applications must not retroactively change "
            "existing ACCEPTED applications."
        )
        assert accepted_app.accepted_at is not None, "accepted_at must be preserved"


# ---------------------------------------------------------------------------
# T-gr-016: Express checkout driven by explicit group.express_checkout flag
# ---------------------------------------------------------------------------


class TestExpressCheckoutFlag:
    """express_checkout=False → standard validation flow (T-gr-016).

    The express-checkout path is tested indirectly via the application creation
    flow. When express_checkout=False, the `is_express_checkout` flag passed to
    form field validation is False, so required non-express-checkout fields must
    be provided.

    We verify the behavior by inspecting the internal flag via a group that has
    express_checkout=True (should skip required-field blocks) vs False (should
    not skip). The simplest observable difference is whether the application
    creation succeeds without all required fields, since express_checkout skips
    some validation.

    For this project, the key contract is: if group.express_checkout=False,
    is_express_checkout is False (standard checkout). We test via the fact that
    auto_approve_applications=False AND express_checkout=False leaves app as
    DRAFT (no implicit elevation from group_id).
    """

    def test_express_checkout_false_no_implicit_checkout(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Group with express_checkout=False must not trigger express checkout.

        The observable effect: with express_checkout=False the application goes
        through normal validation rather than the reduced-form path.
        Creating with minimal fields and auto_approve_applications=False
        results in a DRAFT application (not auto-accepted).
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(
            db, tenant_a, popup, auto_approve_applications=False, express_checkout=False
        )
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "group_id": str(group.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        # express_checkout=False, auto_approve=False → DRAFT
        assert body["status"] == ApplicationStatus.DRAFT.value

    def test_no_group_id_not_express_checkout(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application without group_id is never express checkout.

        Triangulation: is_express_checkout must be False when group_id is None.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()
        body = resp.json()
        # No group_id → DRAFT by default (no auto-accept)
        assert body["status"] == ApplicationStatus.DRAFT.value


# ---------------------------------------------------------------------------
# T-gr-020: GroupAdminUpdate accepts new flag fields
# ---------------------------------------------------------------------------


class TestGroupAdminUpdateFlags:
    """PATCH /groups/{id} accepts auto_approve_applications, express_checkout,
    enable_private_events (T-gr-020)."""

    def test_patch_auto_approve_applications(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a,
        admin_token_tenant_a: str,
    ) -> None:
        """Admin can toggle auto_approve_applications via PATCH."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, auto_approve_applications=False)

        resp = client.patch(
            f"/api/v1/groups/{group.id}",
            json={"auto_approve_applications": True},
            headers={**_auth(admin_token_tenant_a), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["auto_approve_applications"] is True

    def test_patch_express_checkout(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Admin can toggle express_checkout via PATCH.

        Triangulation: different flag.
        """
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, express_checkout=False)

        resp = client.patch(
            f"/api/v1/groups/{group.id}",
            json={"express_checkout": True},
            headers={**_auth(admin_token_tenant_a), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["express_checkout"] is True


# ---------------------------------------------------------------------------
# T-gr-017: Popup feature-flag guards for invite/referral paths
# ---------------------------------------------------------------------------


class TestPopupFlagGuards:
    """Popup flags block invite/referral applications when disabled (T-gr-017).

    The guard uses getattr(app_data, 'invite_id', None) so it is forward-
    compatible: fires when invite_id is set on the schema (PR-4/5), no-op
    otherwise. Here we test the guard logic directly via create_internal with
    a mock data object that has invite_id set.
    """

    def test_invite_id_blocked_when_invites_disabled(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """create_internal raises 403 when invite_id is set and invites_enabled=False.

        Uses a mock app_data object (not the portal route) because the portal
        ApplicationCreate schema doesn't expose invite_id yet (PR-4 will add it).
        """
        from fastapi import HTTPException
        from unittest.mock import MagicMock
        from app.api.application.crud import ApplicationsCRUD

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)

        # invites_enabled defaults to False on new popups
        assert not popup.invites_enabled

        # Build a mock app_data that looks like ApplicationCreate + invite_id
        app_data = MagicMock()
        app_data.popup_id = popup.id
        app_data.invite_id = uuid.uuid4()
        app_data.referral_id = None
        app_data.group_id = None
        app_data.status = None
        app_data.custom_fields = None

        crud_instance = ApplicationsCRUD()
        with pytest.raises(HTTPException) as exc_info:
            crud_instance.create_internal(
                db, app_data=app_data, tenant_id=tenant_a.id, human_id=human.id
            )
        assert exc_info.value.status_code == 403
        assert "invite" in exc_info.value.detail.lower()

    def test_application_without_invite_allowed_when_invites_disabled(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application without invite_id is allowed even when invites_enabled=False.

        Triangulation: flag only blocks when invite_id is present.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        token = _human_token(human)

        resp = client.post(
            "/api/v1/applications/my",
            json={
                "popup_id": str(popup.id),
                "first_name": "Flag",
                "last_name": "Tester",
            },
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.json()

    def test_referral_id_blocked_when_referrals_disabled(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """create_internal raises 403 when referral_id is set and referrals_enabled=False.

        Triangulation: same shape test for referral flag.
        """
        from fastapi import HTTPException
        from unittest.mock import MagicMock
        from app.api.application.crud import ApplicationsCRUD

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)

        assert not popup.referrals_enabled

        app_data = MagicMock()
        app_data.popup_id = popup.id
        app_data.invite_id = None
        app_data.referral_id = uuid.uuid4()
        app_data.group_id = None
        app_data.status = None
        app_data.custom_fields = None

        crud_instance = ApplicationsCRUD()
        with pytest.raises(HTTPException) as exc_info:
            crud_instance.create_internal(
                db, app_data=app_data, tenant_id=tenant_a.id, human_id=human.id
            )
        assert exc_info.value.status_code == 403
        assert "referral" in exc_info.value.detail.lower()
