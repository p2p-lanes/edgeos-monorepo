"""HTTP tests for ``DELETE /events/portal/events/{event_id}``.

The portal's "Delete event" button sits next to "Edit event", but unlike
edit/cancel it is owner only: the host and collaborators get 403, and nobody
can delete on an ended popup.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.audit_log.models import AuditLog
from app.api.event.models import Events
from app.api.event.schemas import EventStatus
from app.api.event_audit.schemas import EventAuditAction
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _make_popup(db: Session, tenant: Tenants, *, status: str = "active") -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Delete Popup {uuid.uuid4().hex[:6]}",
        slug=f"delete-popup-{uuid.uuid4().hex[:6]}",
        status=status,
    )
    db.add(popup)
    db.flush()
    db.add(
        EventSettings(
            tenant_id=tenant.id,
            popup_id=popup.id,
            event_enabled=True,
            can_publish_event=PublishPermission.EVERYONE,
            humans_can_create_venues=True,
            events_require_approval=False,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"delete-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    owner: Humans,
    *,
    host: Humans | None = None,
    collaborators: list[Humans] | None = None,
) -> Events:
    start = datetime(2999, 1, 1, 13, 0, tzinfo=UTC)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        host_id=host.id if host else None,
        collaborator_ids=[c.id for c in collaborators or []],
        title=f"Delete Event {uuid.uuid4().hex[:6]}",
        start_time=start,
        end_time=start + timedelta(hours=1),
        custom_location_name="Test Hall",
        custom_location_url="https://maps.test/hall",
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _url(event_id: uuid.UUID) -> str:
    return f"/api/v1/events/portal/events/{event_id}"


def _event_exists(db: Session, event_id: uuid.UUID) -> bool:
    db.expire_all()
    return db.get(Events, event_id) is not None


class TestPortalEventDelete:
    def test_owner_deletes_event_and_audit_row_is_written(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner)
        event_id = event.id

        response = client.delete(_url(event_id), headers=_auth(owner))

        assert response.status_code == 204, response.text
        assert not _event_exists(db, event_id)
        audit = db.exec(
            select(AuditLog).where(
                AuditLog.entity_id == event_id,
                AuditLog.action == EventAuditAction.DELETED.value,
            )
        ).first()
        assert audit is not None

    def test_host_is_forbidden(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        host = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner, host=host)

        response = client.delete(_url(event.id), headers=_auth(host))

        assert response.status_code == 403, response.text
        assert _event_exists(db, event.id)

    def test_collaborator_is_forbidden(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        collaborator = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner, collaborators=[collaborator])

        response = client.delete(_url(event.id), headers=_auth(collaborator))

        assert response.status_code == 403, response.text
        assert _event_exists(db, event.id)

    def test_cancelled_event_can_be_deleted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner)
        event.status = EventStatus.CANCELLED
        db.add(event)
        db.commit()

        response = client.delete(_url(event.id), headers=_auth(owner))

        assert response.status_code == 204, response.text
        assert not _event_exists(db, event.id)

    def test_unrelated_human_is_forbidden(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        stranger = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner)

        response = client.delete(_url(event.id), headers=_auth(stranger))

        assert response.status_code == 403, response.text
        assert _event_exists(db, event.id)

    def test_missing_event_is_not_found(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        human = _make_human(db, tenant_a)

        response = client.delete(_url(uuid.uuid4()), headers=_auth(human))

        assert response.status_code == 404, response.text

    def test_ended_popup_is_read_only(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, status="ended")
        owner = _make_human(db, tenant_a)
        event = _make_event(db, tenant_a, popup, owner)

        response = client.delete(_url(event.id), headers=_auth(owner))

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == "This popup has ended and is read-only."
        assert _event_exists(db, event.id)
