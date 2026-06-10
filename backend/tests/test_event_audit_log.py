"""Integration test for event mutations writing to the generic audit log.

Every event mutation through the API appends one row to the unified
``audit_logs`` table (entity_type=event) capturing who acted, from which app
(portal vs backoffice), on which event, a snapshot, and — for updates — a
field-level diff stored under ``details``.

Queries ``audit_logs`` directly via the session-scoped ``db`` fixture (the
testcontainer superuser bypasses RLS) to assert what was persisted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_human(db: Session, tenant: Tenants) -> Humans:
    h = Humans(
        tenant_id=tenant.id,
        email=f"collab-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Collab",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Audit Test {uuid.uuid4().hex[:6]}",
        slug=f"audit-events-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _audit_rows(db: Session, event_id: uuid.UUID) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog)
            .where(AuditLog.entity_id == event_id, AuditLog.entity_type == "event")
            .order_by(col(AuditLog.created_at))
        ).all()
    )


class TestBackofficeAuditTrail:
    """A create→update→delete lifecycle from the backoffice records 3 rows."""

    def test_crud_lifecycle_is_audited(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime.now(UTC) + timedelta(days=21)

        # --- create ---
        create = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Audited Launch",
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "visibility": "public",
            },
        )
        assert create.status_code == 201, create.text
        event_id = uuid.UUID(create.json()["id"])

        rows = _audit_rows(db, event_id)
        assert len(rows) == 1
        created = rows[0]
        assert created.action == "event.created"
        assert created.source == "backoffice"
        assert created.actor_type == "user"
        assert created.actor_id == admin_user_tenant_a.id
        assert created.actor_email == admin_user_tenant_a.email
        assert created.entity_label == "Audited Launch"
        assert created.tenant_id == tenant_a.id
        assert created.details is not None
        assert created.details["snapshot"]["visibility"] == "public"
        assert created.details["snapshot"]["title"] == "Audited Launch"

        # --- update (title + visibility change) ---
        update = client.patch(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
            json={"title": "Audited Launch v2", "visibility": "private"},
        )
        assert update.status_code == 200, update.text

        rows = _audit_rows(db, event_id)
        assert len(rows) == 2
        updated = rows[1]
        assert updated.action == "event.updated"
        assert updated.source == "backoffice"
        assert updated.details is not None
        changes = updated.details["changes"]
        assert changes["title"] == {
            "old": "Audited Launch",
            "new": "Audited Launch v2",
        }
        assert changes["visibility"] == {"old": "public", "new": "private"}
        assert updated.details["snapshot"]["title"] == "Audited Launch v2"

        # --- delete ---
        delete = client.delete(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert delete.status_code == 204, delete.text

        rows = _audit_rows(db, event_id)
        assert len(rows) == 3
        deleted = rows[2]
        assert deleted.action == "event.deleted"
        assert deleted.source == "backoffice"
        # The audit row carries the title snapshot even though the event is gone.
        assert deleted.entity_label == "Audited Launch v2"
        assert deleted.entity_id == event_id


class TestAuditWithCollaborators:
    """Regression: deleting an event with collaborators must not crash.

    ``collaborator_ids`` is a ``list[UUID]``; the audit snapshot has to coerce
    each element to a string, otherwise the JSONB write raises "Object of type
    UUID is not JSON serializable" on flush (observed in production).
    """

    def test_delete_event_with_collaborators_is_audited(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        start = datetime.now(UTC) + timedelta(days=21)
        collab_a = _make_human(db, tenant_a)
        collab_b = _make_human(db, tenant_a)

        create = client.post(
            "/api/v1/events",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "title": "Event with collaborators",
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "visibility": "public",
                "collaborator_ids": [str(collab_a.id), str(collab_b.id)],
            },
        )
        assert create.status_code == 201, create.text
        event_id = uuid.UUID(create.json()["id"])

        # The crash happened here: staging the delete audit row flushed a
        # snapshot whose collaborator_ids were raw UUIDs.
        delete = client.delete(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert delete.status_code == 204, delete.text

        rows = _audit_rows(db, event_id)
        deleted = rows[-1]
        assert deleted.action == "event.deleted"
        snapshot_ids = deleted.details["snapshot"]["collaborator_ids"]
        # Stored as JSON strings, not raw UUID objects.
        assert set(snapshot_ids) == {str(collab_a.id), str(collab_b.id)}
        assert all(isinstance(cid, str) for cid in snapshot_ids)
