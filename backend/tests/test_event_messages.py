import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.email_template.models import EmailTemplates
from app.api.event_participant.models import EventParticipants
from app.services.email.service import EmailService
from tests.test_event_participants import (
    _give_ticket,
    _human_headers,
    _make_event,
    _make_human,
    _make_popup,
)


def _setup(db, tenant):
    popup = _make_popup(db, tenant)
    event = _make_event(db, tenant, popup)
    owner = _make_human(db, tenant)
    event.owner_id = owner.id
    db.add(event)
    db.commit()
    return popup, event, owner


def _rsvper(db, tenant, popup, event, *, eligible=True, occurrence=None):
    human = _make_human(db, tenant)
    if eligible:
        _give_ticket(db, tenant, popup, human)
    db.add(
        EventParticipants(
            tenant_id=tenant.id,
            event_id=event.id,
            profile_id=human.id,
            occurrence_start=occurrence,
        )
    )
    db.commit()
    return human


def test_send_filters_audience_records_results_and_deduplicates_retries(
    client, db, tenant_a
):
    popup, event, owner = _setup(db, tenant_a)
    first = _rsvper(db, tenant_a, popup, event)
    second = _rsvper(db, tenant_a, popup, event)
    _rsvper(db, tenant_a, popup, event, eligible=False)
    service = MagicMock(send_event_host_message=AsyncMock(side_effect=[True, False]))
    url = f"/api/v1/event-messages/portal/events/{event.id}"
    body = {"id": str(uuid.uuid4()), "body": "Please arrive ten minutes early."}
    with patch("app.api.event_message.router.get_email_service", return_value=service):
        response = client.post(url, headers=_human_headers(owner), json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        assert (
            result["recipient_count"],
            result["sent_count"],
            result["failed_count"],
        ) == (2, 1, 1)
        assert result["completed_at"] is not None
        assert service.send_event_host_message.await_count == 2
        assert {
            c.kwargs["to"] for c in service.send_event_host_message.await_args_list
        } == {first.email, second.email}
        replay = client.post(url, headers=_human_headers(owner), json=body)
        assert replay.status_code == 200
        assert replay.json() == result
        assert service.send_event_host_message.await_count == 2
        conflict = client.post(
            url,
            headers=_human_headers(owner),
            json={**body, "body": "Different message"},
        )
        assert conflict.status_code == 409
    history = client.get(url, headers=_human_headers(owner))
    assert history.status_code == 200
    assert history.json()["results"] == [result]
    assert first.email not in history.text


def test_only_managers_can_send_and_read_history(client, db, tenant_a, tenant_b):
    _, event, owner = _setup(db, tenant_a)
    host, collaborator, outsider = [_make_human(db, tenant_a) for _ in range(3)]
    foreign = _make_human(db, tenant_b)
    event.host_id = host.id
    event.collaborator_ids = [collaborator.id]
    db.add(event)
    db.commit()
    url = f"/api/v1/event-messages/portal/events/{event.id}"
    for viewer, expected in [
        (owner, 200),
        (host, 200),
        (collaborator, 200),
        (outsider, 403),
        (foreign, 404),
    ]:
        assert client.get(url, headers=_human_headers(viewer)).status_code == expected
        response = client.post(
            url,
            headers=_human_headers(viewer),
            json={"id": str(uuid.uuid4()), "body": "Hello"},
        )
        # Managers with no eligible audience get a clear validation error.
        assert response.status_code == (400 if expected == 200 else expected)


@pytest.mark.parametrize("custom", [False, True])
def test_message_text_is_escaped_in_default_and_popup_templates(
    client, db, tenant_a, custom
):
    popup, event, owner = _setup(db, tenant_a)
    _rsvper(db, tenant_a, popup, event)
    if custom:
        db.add(
            EmailTemplates(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                template_type="event_host_message",
                subject="Notice: {{ event_title }}",
                html_content="<p>Custom template</p><div>{{ host_message }}</div>",
            )
        )
        db.commit()
    service = EmailService()
    with (
        patch.object(service, "send_email", new=AsyncMock(return_value=True)) as send,
        patch("app.api.event_message.router.get_email_service", return_value=service),
    ):
        response = client.post(
            f"/api/v1/event-messages/portal/events/{event.id}",
            headers=_human_headers(owner),
            json={
                "id": str(uuid.uuid4()),
                "body": "<img src=x onerror=alert(1)> {{ 7 * 7 }}",
            },
        )
    assert response.status_code == 200, response.text
    assert response.json()["sent_count"] == 1
    html = send.await_args.kwargs["html_content"]
    assert "<img src=x" not in html
    assert "&lt;img" in html
    assert "{{ 7 * 7 }}" in html
    if custom:
        assert "Custom template" in html
        assert send.await_args.kwargs["subject"] == f"Notice: {event.title}"


def test_occurrence_message_targets_only_that_day(client, db, tenant_a):
    popup, event, owner = _setup(db, tenant_a)
    start = datetime(2026, 10, 1, 14, tzinfo=UTC)
    event.start_time, event.end_time = start, start + timedelta(hours=1)
    event.rrule = "FREQ=DAILY;COUNT=3"
    db.add(event)
    db.commit()
    first = _rsvper(db, tenant_a, popup, event, occurrence=start)
    _rsvper(db, tenant_a, popup, event, occurrence=start + timedelta(days=1))
    service = MagicMock(send_event_host_message=AsyncMock(return_value=True))
    with patch("app.api.event_message.router.get_email_service", return_value=service):
        response = client.post(
            f"/api/v1/event-messages/portal/events/{event.id}",
            headers=_human_headers(owner),
            json={
                "id": str(uuid.uuid4()),
                "body": "For today",
                "occurrence_start": start.isoformat(),
            },
        )
    assert response.status_code == 200, response.text
    assert response.json()["recipient_count"] == 1
    assert service.send_event_host_message.await_args.kwargs["to"] == first.email
    assert (
        "occ=" in service.send_event_host_message.await_args.kwargs["context"].event_url
    )
