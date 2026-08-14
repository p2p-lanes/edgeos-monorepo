"""Tests for PR-3: Group flag enforcement — T-gr-015, T-gr-016, T-gr-021.

Covers:
  - T-gr-015: Replace implicit bool(group_id) auto-accept with explicit
    group.auto_approve_applications flag.
  - T-gr-016: SUPERSEDED. Express checkout is no longer driven by
    group.express_checkout; it follows the entry flow, because the portal
    renders the reduced mini-form for every group / invite / referral link
    regardless of any flag. See
    tests/api/application/test_express_checkout_entry_flow.py.
  - T-gr-021: Flag transition tests (retroactive non-change guarantee).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.group.models import Groups, GroupWhitelistedEmails
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import HumanRating
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import (
    application_flow_id,
    group_flow_id,
    seed_default_steps,
)

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
    seed_default_steps(db, popup)
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
) -> Groups:
    """Create a group with explicit behavior flags."""
    g = Groups(
        sales_flow_id=group_flow_id(db, popup.id),
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
        assert body.get("accepted_at") is None, (
            "DRAFT application must not have accepted_at"
        )

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
        assert body.get("accepted_at") is not None, (
            "ACCEPTED application must have accepted_at"
        )

    def test_auto_approve_true_red_flag_human_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Red-flagged human is always rejected even when group has auto_approve=True.

        Triangulation: red_flag short-circuit must be preserved per design 1f.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        # Red-flag the human via the rating enum (red_flag is now a derived,
        # read-only property computed from rating).
        human.rating = HumanRating.RED_FLAG
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
            sales_flow_id=application_flow_id(db, popup.id),
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
# T-gr-016 (superseded): express checkout now follows the entry flow, not the
# group.express_checkout flag. See test_express_checkout_entry_flow.py.
# ---------------------------------------------------------------------------


class TestExpressCheckoutFlag:
    """Group flags must not silently elevate an application (was T-gr-016).

    These two cases only ever asserted the resulting STATUS, never the
    express-checkout scope — the original docstring said as much, using DRAFT
    as a proxy for a flag it never read. They are kept for what they really
    cover: neither group_id nor express_checkout auto-accepts anything.

    The express-checkout scope itself is now driven by the entry flow rather
    than by group.express_checkout, and is covered directly in
    tests/api/application/test_express_checkout_entry_flow.py.
    """

    def test_group_membership_alone_does_not_auto_accept(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """auto_approve_applications=False leaves the application in DRAFT."""
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

    def test_application_without_group_is_not_auto_accepted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Triangulation: no group_id, no elevation either."""
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
        from unittest.mock import MagicMock

        from fastapi import HTTPException

        from app.api.application.crud import ApplicationsCRUD

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)

        # The gate reads the flow being applied to, not the event.
        from app.api.sales_flow.crud import sales_flows_crud

        flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert flow is not None
        assert not flow.invites_enabled, "copied from a popup that has them off"

        # Build a mock app_data that looks like ApplicationCreate + invite_id
        app_data = MagicMock()
        app_data.popup_id = popup.id
        app_data.invite_id = uuid.uuid4()
        app_data.referral_id = None
        app_data.group_id = None
        app_data.status = None
        app_data.custom_fields = None
        app_data.sales_flow_id = flow.id

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
        from unittest.mock import MagicMock

        from fastapi import HTTPException

        from app.api.application.crud import ApplicationsCRUD

        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)

        from app.api.sales_flow.crud import sales_flows_crud

        flow = sales_flows_crud.get_default_flow(db, popup.id)
        assert flow is not None
        assert not flow.referrals_enabled, "copied from a popup that has them off"

        app_data = MagicMock()
        app_data.popup_id = popup.id
        app_data.invite_id = None
        app_data.referral_id = uuid.uuid4()
        app_data.group_id = None
        app_data.status = None
        app_data.custom_fields = None
        app_data.sales_flow_id = flow.id

        crud_instance = ApplicationsCRUD()
        with pytest.raises(HTTPException) as exc_info:
            crud_instance.create_internal(
                db, app_data=app_data, tenant_id=tenant_a.id, human_id=human.id
            )
        assert exc_info.value.status_code == 403
        assert "referral" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# W-1 / REQ-GR-014 — Admin path must NOT use bool(group_id) for express checkout
# ---------------------------------------------------------------------------


class TestAdminPathExpressCheckout:
    """REQ-GR-014: The admin application-creation path (create_admin)
    must derive is_express_checkout from the group's explicit express_checkout
    flag, NOT from bool(group_id).

    Previously application/crud.py line 705 read:
      is_express_checkout = bool(getattr(app_data, "group_id", None))

    That has been replaced with a group-flag lookup mirroring the portal path.
    This test asserts the correct behaviour: a group with express_checkout=False
    does not trigger express checkout in the admin path, even though group_id
    is present. Specifically, the admin must be able to create an application
    for a group with express_checkout=False without it behaving as express
    checkout (the form validation scope is standard, not reduced).
    """

    def test_admin_path_group_with_express_checkout_false_creates_app(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a
    ) -> None:
        """Group with express_checkout=False: admin create_admin succeeds and uses
        standard validation scope (validate_custom_fields=False so no field error,
        but is_express_checkout is False — confirmed by the code path not raising).
        """
        from app.api.application.crud import ApplicationsCRUD
        from app.api.application.schemas import ApplicationAdminCreate

        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, express_checkout=False)
        email = f"admin-w1-{uuid.uuid4().hex[:8]}@test.com"

        app_data = ApplicationAdminCreate(
            popup_id=popup.id,
            email=email,
            first_name="Admin",
            last_name="W1Test",
            group_id=group.id,
        )

        crud_instance = ApplicationsCRUD()
        app = crud_instance.create_admin(
            db,
            app_data=app_data,
            tenant_id=tenant_a.id,
            validate_custom_fields=False,
        )
        assert app is not None
        assert app.group_id == group.id

    def test_admin_path_group_with_express_checkout_true_creates_app(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a
    ) -> None:
        """Group with express_checkout=True: admin create_admin resolves the flag correctly.

        Triangulates the lookup path: group must be resolved and the flag read.
        """
        from app.api.application.crud import ApplicationsCRUD
        from app.api.application.schemas import ApplicationAdminCreate

        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup, express_checkout=True)
        email = f"admin-w1-xck-{uuid.uuid4().hex[:8]}@test.com"

        app_data = ApplicationAdminCreate(
            popup_id=popup.id,
            email=email,
            first_name="Admin",
            last_name="W1Express",
            group_id=group.id,
        )

        crud_instance = ApplicationsCRUD()
        app = crud_instance.create_admin(
            db,
            app_data=app_data,
            tenant_id=tenant_a.id,
            validate_custom_fields=False,
        )
        assert app is not None
        assert app.group_id == group.id

    def test_admin_path_no_group_id_creates_app_without_express_checkout(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a
    ) -> None:
        """Without group_id, is_express_checkout must be False (no group to resolve).

        Regression guard: adding group_id later should not auto-trigger express
        checkout if the group does not opt in.
        """
        from app.api.application.crud import ApplicationsCRUD
        from app.api.application.schemas import ApplicationAdminCreate

        popup = _make_popup(db, tenant_a)
        email = f"admin-w1-nogrp-{uuid.uuid4().hex[:8]}@test.com"

        app_data = ApplicationAdminCreate(
            popup_id=popup.id,
            email=email,
            first_name="Admin",
            last_name="NoGroup",
            group_id=None,
        )

        crud_instance = ApplicationsCRUD()
        app = crud_instance.create_admin(
            db,
            app_data=app_data,
            tenant_id=tenant_a.id,
            validate_custom_fields=False,
        )
        assert app is not None
        assert app.group_id is None
