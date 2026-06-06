"""Tests for group membership visibility in portal (list + detail).

Covers:
  (a) list_my_groups returns a group where human is only a member (not leader)
  (b) is_leader=True for leaders, is_leader=False for members
  (c) get_my_group returns 200 for a member and for a leader
  (d) a non-member/non-leader gets 403
  (e) mutation endpoints (PATCH, add/remove member) still 403 for regular members
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"MemberTest {uuid.uuid4().hex[:6]}",
        slug=f"membertest-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"membertest-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Member",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_group(db: Session, tenant: Tenants, popup: Popups) -> Groups:
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Member Group {uuid.uuid4().hex[:6]}",
        slug=f"member-grp-{uuid.uuid4().hex[:8]}",
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def _add_leader(db: Session, group: Groups, human: Humans) -> None:
    db.add(
        GroupLeaders(tenant_id=group.tenant_id, group_id=group.id, human_id=human.id)
    )
    db.commit()


def _add_member(db: Session, group: Groups, human: Humans) -> None:
    db.add(
        GroupMembers(tenant_id=group.tenant_id, group_id=group.id, human_id=human.id)
    )
    db.commit()


# ---------------------------------------------------------------------------
# (a) list_my_groups includes a group where human is only a member
# ---------------------------------------------------------------------------


class TestListMyGroupsIncludesMembers:
    def test_member_only_group_appears_in_list(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """GET /my/groups must return groups where human is a member (not just leader)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        # human is a member, NOT a leader
        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.get("/api/v1/groups/my/groups", headers=_auth(token))
        assert resp.status_code == 200, resp.json()

        ids = [r["id"] for r in resp.json()["results"]]
        assert str(group.id) in ids, "Member-only group must appear in list"

    # ---------------------------------------------------------------------------
    # (b) is_leader flag is correct for leader vs member
    # ---------------------------------------------------------------------------

    def test_is_leader_true_for_leader(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """is_leader must be True when human is a leader of the group."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        _add_leader(db, group, human)

        token = _human_token(human)
        resp = client.get("/api/v1/groups/my/groups", headers=_auth(token))
        assert resp.status_code == 200, resp.json()

        matching = [r for r in resp.json()["results"] if r["id"] == str(group.id)]
        assert len(matching) == 1
        assert matching[0]["is_leader"] is True

    def test_is_leader_false_for_member(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """is_leader must be False when human is a member but not a leader."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.get("/api/v1/groups/my/groups", headers=_auth(token))
        assert resp.status_code == 200, resp.json()

        matching = [r for r in resp.json()["results"] if r["id"] == str(group.id)]
        assert len(matching) == 1
        assert matching[0]["is_leader"] is False

    def test_no_duplicate_when_both_leader_and_member(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A human who is both leader and member must appear exactly once."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)

        _add_leader(db, group, human)
        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.get("/api/v1/groups/my/groups", headers=_auth(token))
        assert resp.status_code == 200, resp.json()

        matching = [r for r in resp.json()["results"] if r["id"] == str(group.id)]
        assert len(matching) == 1, (
            "Group must appear exactly once even if both leader and member"
        )
        assert matching[0]["is_leader"] is True


# ---------------------------------------------------------------------------
# (c) get_my_group returns 200 for member and for leader
# ---------------------------------------------------------------------------


class TestGetMyGroupAccessControl:
    def test_leader_can_get_group(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """GET /my/{group_id} must return 200 for a leader."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_leader(db, group, human)

        token = _human_token(human)
        resp = client.get(f"/api/v1/groups/my/{group.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.json()
        assert resp.json()["is_leader"] is True

    def test_member_can_get_group(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """GET /my/{group_id} must return 200 for a member (read-only)."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.get(f"/api/v1/groups/my/{group.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.json()
        assert resp.json()["is_leader"] is False

    # ---------------------------------------------------------------------------
    # (d) non-member/non-leader gets 403
    # ---------------------------------------------------------------------------

    def test_non_member_gets_403(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """GET /my/{group_id} must return 403 for a human with no relation to the group."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        # human is neither leader nor member

        token = _human_token(human)
        resp = client.get(f"/api/v1/groups/my/{group.id}", headers=_auth(token))
        assert resp.status_code == 403, resp.json()


# ---------------------------------------------------------------------------
# (e) mutation endpoints still 403 for regular members
# ---------------------------------------------------------------------------


class TestMutationEndpointsLeaderGated:
    def test_member_cannot_patch_group(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """PATCH /my/{group_id} must be 403 for a regular member."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.patch(
            f"/api/v1/groups/my/{group.id}",
            json={"description": "hacked"},
            headers=_auth(token),
        )
        assert resp.status_code == 403, resp.json()

    def test_member_cannot_add_member(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """POST /my/{group_id}/members must be 403 for a regular member."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_member(db, group, human)

        token = _human_token(human)
        resp = client.post(
            f"/api/v1/groups/my/{group.id}/members",
            json={
                "first_name": "New",
                "last_name": "Guy",
                "email": f"new-{uuid.uuid4().hex[:6]}@test.com",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 403, resp.json()

    def test_member_cannot_remove_member(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """DELETE /my/{group_id}/members/{human_id} must be 403 for a regular member."""
        popup = _make_popup(db, tenant_a)
        member_human = _make_human(db, tenant_a)
        other_human = _make_human(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        _add_member(db, group, member_human)
        _add_member(db, group, other_human)

        token = _human_token(member_human)
        resp = client.delete(
            f"/api/v1/groups/my/{group.id}/members/{other_human.id}",
            headers=_auth(token),
        )
        assert resp.status_code == 403, resp.json()
