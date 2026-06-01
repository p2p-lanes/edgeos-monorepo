"""Integration tests for the event audit log.

Every event mutation through the API should append exactly one row to
``event_audit_logs`` capturing who acted, from which app (Portal vs
Backoffice), on which event, a snapshot of the relevant fields, and — for
updates — a field-level diff.

These tests query ``event_audit_logs`` directly via the session-scoped ``db``
fixture (the testcontainer superuser bypasses RLS) to assert what was persisted.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event_audit.models import EventAuditLog
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


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


def _audit_rows(db: Session, event_id: uuid.UUID) -> list[EventAuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(EventAuditLog)
            .where(EventAuditLog.event_id == event_id)
            .order_by(EventAuditLog.occurred_at)  # type: ignore[arg-type]
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
        assert created.action == "created"
        assert created.source == "backoffice"
        assert created.actor_type == "user"
        assert created.actor_id == admin_user_tenant_a.id
        assert created.actor_email == admin_user_tenant_a.email
        assert created.event_title == "Audited Launch"
        assert created.tenant_id == tenant_a.id
        assert created.snapshot["visibility"] == "public"
        assert created.snapshot["title"] == "Audited Launch"

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
        assert updated.action == "updated"
        assert updated.source == "backoffice"
        assert updated.changes is not None
        assert updated.changes["title"] == {
            "old": "Audited Launch",
            "new": "Audited Launch v2",
        }
        assert updated.changes["visibility"] == {"old": "public", "new": "private"}
        assert updated.snapshot["title"] == "Audited Launch v2"

        # --- delete ---
        delete = client.delete(
            f"/api/v1/events/{event_id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert delete.status_code == 204, delete.text

        rows = _audit_rows(db, event_id)
        assert len(rows) == 3
        deleted = rows[2]
        assert deleted.action == "deleted"
        assert deleted.source == "backoffice"
        # The audit row carries the title snapshot even though the event is gone.
        assert deleted.event_title == "Audited Launch v2"
        assert deleted.event_id == event_id
