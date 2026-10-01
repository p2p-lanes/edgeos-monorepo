import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.human.crud import humans_crud
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _human(db: Session, tenant: Tenants, first_name: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"{first_name.lower()}-{uuid.uuid4().hex[:8]}@test.com",
        first_name=first_name,
        last_name="Test",
    )
    db.add(human)
    db.flush()
    return human


def test_profile_event_stats_use_checkins_and_human_host_only(
    db: Session, tenant_a: Tenants
) -> None:
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Profile stats popup",
        slug=f"profile-stats-{uuid.uuid4().hex[:8]}",
    )
    second_popup = Popups(
        tenant_id=tenant_a.id,
        name="Second profile stats popup",
        slug=f"profile-stats-second-{uuid.uuid4().hex[:8]}",
    )
    host = _human(db, tenant_a, "Host")
    attendee = _human(db, tenant_a, "Attendee")
    other_host = _human(db, tenant_a, "Other host")
    creator_only = _human(db, tenant_a, "Creator")
    db.add_all([popup, second_popup])
    db.flush()

    def event(
        title: str,
        *,
        owner_id: uuid.UUID,
        host_id=None,
        event_popup: Popups = popup,
        tags: list[str] | None = None,
    ) -> Events:
        start = datetime(2030, 1, 1, 10, tzinfo=UTC)
        return Events(
            tenant_id=tenant_a.id,
            popup_id=event_popup.id,
            owner_id=owner_id,
            host_id=host_id,
            title=title,
            start_time=start,
            end_time=start + timedelta(hours=1),
            timezone="UTC",
            tags=tags or [],
            status=EventStatus.PUBLISHED,
        )

    hosted_event = event("Hosted event", owner_id=uuid.uuid4(), host_id=host.id)
    cross_popup_event = event(
        "Cross-popup hosted event",
        owner_id=uuid.uuid4(),
        host_id=host.id,
        event_popup=second_popup,
    )
    attended_cross_popup_event = event(
        "Attended cross-popup event",
        owner_id=uuid.uuid4(),
        host_id=other_host.id,
        event_popup=second_popup,
        tags=["AI"],
    )
    owner_created_event = event("Owner-only event", owner_id=creator_only.id)
    db.add_all(
        [
            hosted_event,
            cross_popup_event,
            attended_cross_popup_event,
            owner_created_event,
        ]
    )
    db.flush()
    db.add_all(
        [
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=hosted_event.id,
                profile_id=attendee.id,
                status=ParticipantStatus.CHECKED_IN,
            ),
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=cross_popup_event.id,
                profile_id=attendee.id,
                status=ParticipantStatus.CHECKED_IN,
            ),
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=attended_cross_popup_event.id,
                profile_id=host.id,
                status=ParticipantStatus.CHECKED_IN,
            ),
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=attended_cross_popup_event.id,
                profile_id=attendee.id,
                status=ParticipantStatus.CHECKED_IN,
            ),
            EventParticipants(
                tenant_id=tenant_a.id,
                event_id=owner_created_event.id,
                profile_id=creator_only.id,
                status=ParticipantStatus.REGISTERED,
            ),
        ]
    )
    db.commit()

    host_stats = humans_crud.get_profile_stats(db, host.id)
    assert host_stats.events_attended == 1
    assert host_stats.events_hosted == 2
    assert host_stats.hosted_attendees_count == 1
    assert host_stats.top_event_theme == "AI"
    assert [
        (person.human_id, person.event_count)
        for person in host_stats.most_shared_attendees
    ] == [(attendee.id, 1)]
    assert [
        (event.title, event.timezone)
        for event in host_stats.most_shared_attendees[0].shared_events
    ] == [("Attended cross-popup event", "UTC")]
    assert [
        (person.human_id, person.event_count)
        for person in host_stats.most_active_attendees_of_hosted_events
    ] == [(attendee.id, 2)]

    owner_stats = humans_crud.get_profile_stats(db, other_host.id)
    assert owner_stats.events_attended == 0
    assert owner_stats.events_hosted == 1

    creator_stats = humans_crud.get_profile_stats(db, creator_only.id)
    assert creator_stats.events_hosted == 0
