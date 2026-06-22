"""Tests for the per-human comments thread (mirrors task comments).

Any backoffice user can read/add comments, the author edits their own, and the
author or a superadmin soft-deletes. Comments are scoped to the caller's tenant.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.tenant.models import Tenants


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"comment-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Comment",
        last_name="Target",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


class TestHumanComments:
    def test_create_and_list_comment(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}

        resp = client.post(
            f"/api/v1/humans/{human.id}/comments",
            headers=headers,
            json={"body": "Great attendee, **star** material."},
        )
        assert resp.status_code == 201, resp.text
        created = resp.json()
        assert created["body"] == "Great attendee, **star** material."
        assert created["human_id"] == str(human.id)
        assert created["author_user_id"] is not None
        assert created["edited_at"] is None

        resp = client.get(
            f"/api/v1/humans/{human.id}/comments", headers=headers
        )
        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        assert len(results) == 1
        assert results[0]["id"] == created["id"]

    def test_edit_own_comment_sets_edited_at(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}

        created = client.post(
            f"/api/v1/humans/{human.id}/comments",
            headers=headers,
            json={"body": "original"},
        ).json()

        resp = client.put(
            f"/api/v1/humans/{human.id}/comments/{created['id']}",
            headers=headers,
            json={"body": "edited"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["body"] == "edited"
        assert body["edited_at"] is not None

    def test_delete_comment_hides_it_from_list(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        human = _make_human(db, tenant_a)
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}

        created = client.post(
            f"/api/v1/humans/{human.id}/comments",
            headers=headers,
            json={"body": "to delete"},
        ).json()

        resp = client.delete(
            f"/api/v1/humans/{human.id}/comments/{created['id']}",
            headers=headers,
        )
        assert resp.status_code == 204, resp.text

        results = client.get(
            f"/api/v1/humans/{human.id}/comments", headers=headers
        ).json()["results"]
        assert results == []

    def test_comments_on_other_tenant_human_are_404(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_b: Tenants,
    ) -> None:
        other_human = _make_human(db, tenant_b)
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}

        resp = client.get(
            f"/api/v1/humans/{other_human.id}/comments", headers=headers
        )
        assert resp.status_code == 404, resp.text
