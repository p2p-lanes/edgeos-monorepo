"""Tests for POST /api/v1/groups/{id}/members/by-application — T-gr-018.

Adds an existing approved human to a group M:N WITHOUT creating a duplicate
application. Guard: admin or group leader.

Spec: REQ-GR-013, REQ-GR-015.
Design: Decision 1f (M:N entry points).
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _user_token(user: Users) -> str:
    return create_access_token(subject=user.id, token_type="user")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"ByApp {uuid.uuid4().hex[:6]}",
        slug=f"byapp-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"byapp-{uuid.uuid4().hex[:8]}@test.com",
        first_name="ByApp",
        last_name="Test",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_group(db: Session, tenant: Tenants, popup: Popups) -> Groups:
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"ByApp Group {uuid.uuid4().hex[:6]}",
        slug=f"byapp-grp-{uuid.uuid4().hex[:8]}",
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    status: ApplicationStatus = ApplicationStatus.ACCEPTED,
) -> Applications:
    app = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=status.value,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def _add_leader(db: Session, group: Groups, human: Humans) -> None:
    leader = GroupLeaders(
        tenant_id=group.tenant_id,
        group_id=group.id,
        human_id=human.id,
    )
    db.add(leader)
    db.commit()


def _is_member(db: Session, group_id: uuid.UUID, human_id: uuid.UUID) -> bool:
    row = db.exec(
        select(GroupMembers).where(
            GroupMembers.group_id == group_id,
            GroupMembers.human_id == human_id,
        )
    ).first()
    return row is not None


# ---------------------------------------------------------------------------
# T-gr-018: POST /groups/{id}/members/by-application
# ---------------------------------------------------------------------------


class TestMembersByApplication:
    """Verify the M:N membership entry point that does not create a duplicate application."""

    def test_admin_adds_approved_human_to_group(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Admin can add an approved human to a group via their application id.

        Admin route: POST /groups/{id}/members/by-application (admin token).
        RED: endpoint doesn't exist yet — test must fail.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        app = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.ACCEPTED
        )

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 201, resp.json()
        body = resp.json()
        # Response must be a GroupMemberPublic (has id, email fields)
        assert body["id"] == str(human.id)
        assert body["email"] == human.email
        # Human is now a member
        assert _is_member(db, group.id, human.id), "human must be in group_members"

    def test_leader_adds_approved_human_to_group(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Group leader can add an approved human via application id.

        Leader route: POST /groups/my/{group_id}/members/by-application (human token).
        """
        popup = _make_popup(db, tenant_a)
        leader_human = _make_human(db, tenant_a)
        target_human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_leader(db, group, leader_human)
        app = _make_application(db, tenant_a, popup, target_human)

        token = _human_token(leader_human)
        resp = client.post(
            f"/api/v1/groups/my/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.json()
        assert _is_member(db, group.id, target_human.id)

    def test_forbidden_for_non_leader_non_admin(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Non-leader portal human cannot add members via this endpoint."""
        popup = _make_popup(db, tenant_a)
        regular_human = _make_human(db, tenant_a)
        target_human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        app = _make_application(db, tenant_a, popup, target_human)

        token = _human_token(regular_human)
        resp = client.post(
            f"/api/v1/groups/my/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers=_auth(token),
        )
        assert resp.status_code == 403, resp.json()

    def test_404_application_not_found(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Returns 404 when application_id doesn't exist (admin route)."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(uuid.uuid4())},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 404, resp.json()

    def test_422_application_not_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Returns 422 when application is not in ACCEPTED status (admin route)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        app = _make_application(
            db, tenant_a, popup, human, status=ApplicationStatus.DRAFT
        )

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 422, resp.json()

    def test_422_application_popup_mismatch(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Returns 422 when application belongs to a different popup than the group (admin route)."""
        popup1 = _make_popup(db, tenant_a)
        popup2 = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup1)
        # Application is for popup2, but group is in popup1
        app = _make_application(
            db, tenant_a, popup2, human, status=ApplicationStatus.ACCEPTED
        )

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 422, resp.json()

    def test_idempotent_already_member(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Calling the endpoint for an already-member human returns 200.

        Idempotency per spec REQ-GR-015: no duplicate row, no error.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        app = _make_application(db, tenant_a, popup, human)

        # Pre-add as member
        db.add(
            GroupMembers(
                tenant_id=tenant_a.id,
                group_id=group.id,
                human_id=human.id,
            )
        )
        db.commit()

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        # Idempotent: 200 (already member — return current state without error)
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["id"] == str(human.id)

        # No duplicate rows
        rows = list(
            db.exec(
                select(GroupMembers).where(
                    GroupMembers.group_id == group.id,
                    GroupMembers.human_id == human.id,
                )
            ).all()
        )
        assert len(rows) == 1, "Must not create duplicate group_members row"

    def test_no_duplicate_application_created(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Adding via by-application must not create a new application row.

        Spec: REQ-GR-013 'without creating duplicate applications'.
        """
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        app = _make_application(db, tenant_a, popup, human)

        app_count_before = len(
            list(
                db.exec(
                    select(Applications).where(Applications.human_id == human.id)
                ).all()
            )
        )

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 201, resp.json()

        app_count_after = len(
            list(
                db.exec(
                    select(Applications).where(Applications.human_id == human.id)
                ).all()
            )
        )
        assert app_count_after == app_count_before, (
            "Adding via by-application must not create new Applications rows"
        )

    def test_409_when_group_full_admin(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """Returns 409 when the group has hit max_members (admin route)."""
        popup = _make_popup(db, tenant_a)

        # Create a group with max_members=1
        group = Groups(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name=f"Full Group {uuid.uuid4().hex[:6]}",
            slug=f"full-{uuid.uuid4().hex[:8]}",
            max_members=1,
        )
        db.add(group)
        db.commit()
        db.refresh(group)

        # Fill the group
        blocker = _make_human(db, tenant_a)
        db.add(
            GroupMembers(tenant_id=tenant_a.id, group_id=group.id, human_id=blocker.id)
        )
        db.commit()

        # Try to add another human
        target = _make_human(db, tenant_a)
        app = _make_application(
            db, tenant_a, popup, target, status=ApplicationStatus.ACCEPTED
        )

        token = _user_token(admin_user_tenant_a)
        resp = client.post(
            f"/api/v1/groups/{group.id}/members/by-application",
            json={"application_id": str(app.id)},
            headers={**_auth(token), "X-Tenant-Id": str(tenant_a.id)},
        )
        assert resp.status_code == 409, resp.json()
        assert not _is_member(db, group.id, target.id)
