"""Integration tests for the event participants state machine.

Exercises the portal RSVP flow (register / cancel / check-in) and the
backoffice endpoints (admin add / update / delete).

Covers invariants:
- Portal register on a published event creates a REGISTERED row and
  fires an iTIP REQUEST to the registering human only.
- Portal register on a DRAFT/CANCELLED event is rejected.
- max_participant is enforced at registration time.
- Re-registering after cancelling reactivates the same row and updates
  registered_at; registered_at is preserved across cancel.
- Portal cancel-registration flips to CANCELLED and sends iTIP CANCEL.
- Portal check-in transitions REGISTERED → CHECKED_IN and stamps
  check_time; it refuses to act on a cancelled or missing registration.
- Admin add dedupes against cancelled rows (reactivates) and conflicts
  on active rows.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantRole, ParticipantStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Participants Test {uuid.uuid4().hex[:6]}",
        slug=f"participants-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    status: EventStatus = EventStatus.PUBLISHED,
    max_participant: int | None = None,
    start_offset_days: int = 7,
) -> Events:
    start = datetime.now(UTC) + timedelta(days=start_offset_days)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Participant State Machine Test",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=status,
        max_participant=max_participant,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_human(db: Session, tenant: Tenants, *, email: str | None = None) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email or f"participant-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _human_headers(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _fetch_participant(
    db: Session, event_id: uuid.UUID, profile_id: uuid.UUID
) -> EventParticipants | None:
    return db.exec(
        select(EventParticipants)
        .where(EventParticipants.event_id == event_id)
        .where(EventParticipants.profile_id == profile_id)
    ).first()


# Patch target: the router imports send_itip_to_single_recipient lazily
# from app.services.event_itip inside _notify_rsvp, so patching the module
# attribute intercepts every real dispatch.
_ITIP_TARGET = "app.services.event_itip.send_itip_to_single_recipient"


# ---------------------------------------------------------------------------
# Portal: register
# ---------------------------------------------------------------------------


class TestPortalRegister:
    """POST /event-participants/portal/register/{event_id}."""

    def test_register_creates_row_and_dispatches_request(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)) as itip_mock:
            resp = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
                json={"role": ParticipantRole.ATTENDEE.value},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == ParticipantStatus.REGISTERED.value
        assert body["profile_id"] == str(human.id)

        db.expire_all()
        row = _fetch_participant(db, event.id, human.id)
        assert row is not None
        assert row.status == ParticipantStatus.REGISTERED
        assert row.registered_at is not None

        # iTIP REQUEST fires exactly once, for the registering human only.
        assert itip_mock.await_count == 1
        kwargs = itip_mock.await_args.kwargs
        assert kwargs["method"] == "REQUEST"
        assert kwargs["email"] == human.email
        assert kwargs["human_id"] == human.id

    def test_register_on_draft_event_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, status=EventStatus.DRAFT)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)) as itip_mock:
            resp = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )

        assert resp.status_code == 400, resp.text
        assert itip_mock.await_count == 0
        assert _fetch_participant(db, event.id, human.id) is None

    def test_register_on_cancelled_event_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, status=EventStatus.CANCELLED)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            resp = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )

        assert resp.status_code == 400, resp.text

    def test_duplicate_active_registration_conflicts(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            first = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
            assert first.status_code == 200, first.text

            second = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
            assert second.status_code == 409, second.text

    def test_max_participant_enforced(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup, max_participant=1)
        first_human = _make_human(db, tenant_a)
        second_human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            first = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(first_human),
            )
            assert first.status_code == 200, first.text

            second = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(second_human),
            )

        assert second.status_code == 409, second.text
        assert "full" in second.json()["detail"].lower()
        assert _fetch_participant(db, event.id, second_human.id) is None

    def test_reregister_after_cancel_reactivates_row(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
            db.expire_all()
            original = _fetch_participant(db, event.id, human.id)
            assert original is not None
            original_id = original.id
            first_registered_at = original.registered_at

            client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )

            resp = client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
                json={"role": ParticipantRole.ATTENDEE.value},
            )

        assert resp.status_code == 200, resp.text
        db.expire_all()
        row = _fetch_participant(db, event.id, human.id)
        assert row is not None
        # Same DB row, reactivated.
        assert row.id == original_id
        assert row.status == ParticipantStatus.REGISTERED
        assert row.registered_at >= first_registered_at


# ---------------------------------------------------------------------------
# Portal: cancel
# ---------------------------------------------------------------------------


class TestPortalCancelRegistration:
    """POST /event-participants/portal/cancel-registration/{event_id}."""

    def test_cancel_flips_status_preserves_registered_at_and_notifies(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
        db.expire_all()
        registered_at_before = _fetch_participant(db, event.id, human.id).registered_at

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)) as itip_mock:
            resp = client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == ParticipantStatus.CANCELLED.value

        db.expire_all()
        row = _fetch_participant(db, event.id, human.id)
        assert row is not None
        assert row.status == ParticipantStatus.CANCELLED
        assert row.registered_at == registered_at_before

        assert itip_mock.await_count == 1
        assert itip_mock.await_args.kwargs["method"] == "CANCEL"
        assert itip_mock.await_args.kwargs["email"] == human.email

    def test_cancel_without_registration_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)) as itip_mock:
            resp = client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )

        assert resp.status_code == 404, resp.text
        assert itip_mock.await_count == 0

    def test_cancel_when_already_cancelled_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
            first_cancel = client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )
            assert first_cancel.status_code == 200

            second_cancel = client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )

        assert second_cancel.status_code == 404, second_cancel.text


# ---------------------------------------------------------------------------
# Portal: check-in
# ---------------------------------------------------------------------------


class TestPortalCheckIn:
    """POST /event-participants/portal/check-in/{event_id}."""

    def test_check_in_transitions_registered_to_checked_in(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )

        before = datetime.now(UTC)
        resp = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_human_headers(human),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == ParticipantStatus.CHECKED_IN.value
        assert body["check_time"] is not None

        db.expire_all()
        row = _fetch_participant(db, event.id, human.id)
        assert row is not None
        assert row.status == ParticipantStatus.CHECKED_IN
        assert row.check_time is not None
        assert row.check_time >= before - timedelta(seconds=5)

    def test_check_in_without_registration_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        resp = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_human_headers(human),
        )

        assert resp.status_code == 404, resp.text

    def test_check_in_on_cancelled_registration_returns_404(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
            client.post(
                f"/api/v1/event-participants/portal/cancel-registration/{event.id}",
                headers=_human_headers(human),
            )

        resp = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_human_headers(human),
        )

        assert resp.status_code == 404, resp.text

    def test_double_check_in_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        human = _make_human(db, tenant_a)

        with patch(_ITIP_TARGET, new=AsyncMock(return_value=None)):
            client.post(
                f"/api/v1/event-participants/portal/register/{event.id}",
                headers=_human_headers(human),
            )
        first = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_human_headers(human),
        )
        assert first.status_code == 200

        second = client.post(
            f"/api/v1/event-participants/portal/check-in/{event.id}",
            headers=_human_headers(human),
        )
        assert second.status_code == 400, second.text


# ---------------------------------------------------------------------------
# Backoffice: admin CRUD
# ---------------------------------------------------------------------------


class TestAdminParticipantCrud:
    """Backoffice endpoints under /event-participants."""

    def test_admin_add_creates_participant(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        profile_id = uuid.uuid4()

        resp = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "event_id": str(event.id),
                "profile_id": str(profile_id),
                "role": ParticipantRole.SPEAKER.value,
                "message": "Guest speaker",
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["role"] == ParticipantRole.SPEAKER.value
        assert body["status"] == ParticipantStatus.REGISTERED.value

        db.expire_all()
        row = _fetch_participant(db, event.id, profile_id)
        assert row is not None
        assert row.status == ParticipantStatus.REGISTERED

    def test_admin_add_on_existing_active_row_conflicts(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        profile_id = uuid.uuid4()

        first = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "event_id": str(event.id),
                "profile_id": str(profile_id),
            },
        )
        assert first.status_code == 201, first.text

        second = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "event_id": str(event.id),
                "profile_id": str(profile_id),
            },
        )

        assert second.status_code == 409, second.text

    def test_admin_add_reactivates_cancelled_row(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        profile_id = uuid.uuid4()

        created = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={"event_id": str(event.id), "profile_id": str(profile_id)},
        )
        assert created.status_code == 201
        participant_id = created.json()["id"]

        cancel_patch = client.patch(
            f"/api/v1/event-participants/{participant_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"status": ParticipantStatus.CANCELLED.value},
        )
        assert cancel_patch.status_code == 200

        readd = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "event_id": str(event.id),
                "profile_id": str(profile_id),
                "role": ParticipantRole.HOST.value,
            },
        )

        assert readd.status_code == 201, readd.text
        body = readd.json()
        assert body["id"] == participant_id
        assert body["status"] == ParticipantStatus.REGISTERED.value
        assert body["role"] == ParticipantRole.HOST.value

    def test_admin_delete_removes_participant(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        event = _make_event(db, tenant_a, popup)
        profile_id = uuid.uuid4()

        created = client.post(
            "/api/v1/event-participants",
            headers=_admin_headers(admin_token_tenant_a),
            json={"event_id": str(event.id), "profile_id": str(profile_id)},
        )
        participant_id = created.json()["id"]

        resp = client.delete(
            f"/api/v1/event-participants/{participant_id}",
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert resp.status_code == 204, resp.text
        db.expire_all()
        assert _fetch_participant(db, event.id, profile_id) is None


# ---------------------------------------------------------------------------
# Concurrency — not covered here
# ---------------------------------------------------------------------------


@pytest.mark.skip(
    reason=(
        "Concurrent-registration race needs true parallel clients and a "
        "stricter SELECT ... FOR UPDATE guard in register_for_event. "
        "Covered as a follow-up once the write path is locked."
    )
)
def test_concurrent_registrations_respect_max_participant() -> None:
    """Placeholder for the max_participant race-condition test."""
