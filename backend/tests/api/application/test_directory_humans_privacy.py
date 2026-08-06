"""Privacy tests for popup-scoped host picker + RSVP name hiding.

Covers the privacy fix that:

- Scopes the portal host picker (``find_directory_humans``) to a popup's
  accepted attendees who share their name, EXCLUDING anyone who put
  "first_name"/"last_name" in ``info_not_shared`` and anyone who is not an
  accepted ticket-holding attendee of that popup.
- Excludes (does not mask) RSVP participants who hid their name for the event's
  popup, via ``human_ids_hiding_name``.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.event.models import Events
from app.api.event.schemas import EventStatus
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import ParticipantStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers (mirror tests/api/application/test_attendee_directory.py)
# ---------------------------------------------------------------------------


def _popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name="Host Picker Popup",
        slug=f"host-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _category(
    db: Session, popup: Popups, key: str, *, is_primary: bool
) -> AttendeeCategories:
    cat = AttendeeCategories(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        key=key,
        label=key.capitalize(),
        is_primary=is_primary,
        enabled_in_passes_flow=True,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _human(db: Session, tenant: Tenants, first: str, last: str, **extra) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"{first.lower()}-{uuid.uuid4().hex[:6]}@test.com",
        first_name=first,
        last_name=last,
        **extra,
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _product(db: Session, popup: Popups, name: str = "GA") -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("100.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _application(
    db: Session,
    popup: Popups,
    human: Humans,
    *,
    status: str = ApplicationStatus.ACCEPTED.value,
    info_not_shared: list[str] | None = None,
) -> Applications:
    app = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        info_not_shared=info_not_shared or [],
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def _attendee(
    db: Session,
    popup: Popups,
    app: Applications,
    human: Humans,
    category: AttendeeCategories,
    *,
    tickets: int = 1,
    product: Products | None = None,
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        application_id=app.id,
        popup_id=popup.id,
        human_id=human.id,
        name=f"{human.first_name} {human.last_name}",
        category_id=category.id,
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    if tickets:
        prod = product or _product(db, popup)
        for _ in range(tickets):
            db.add(
                AttendeeProducts(
                    id=uuid.uuid4(),
                    tenant_id=popup.tenant_id,
                    attendee_id=attendee.id,
                    product_id=prod.id,
                    check_in_code=uuid.uuid4().hex[:10].upper(),
                )
            )
        db.commit()
        db.refresh(attendee)
    return attendee


# ---------------------------------------------------------------------------
# find_directory_humans — host picker
# ---------------------------------------------------------------------------


@pytest.fixture()
def picker_world(db: Session, tenant_a: Tenants):
    """A popup with: a name-sharing attendee, a name-hiding attendee, and a
    non-attendee human in the same tenant."""
    popup = _popup(db, tenant_a)
    main = _category(db, popup, "main", is_primary=True)

    sharer = _human(db, tenant_a, "Shara", "Sharer")
    sharer_app = _application(db, popup, sharer)
    _attendee(db, popup, sharer_app, sharer, main, tickets=1)

    hider = _human(db, tenant_a, "Hilda", "Hider")
    hider_app = _application(db, popup, hider, info_not_shared=["first_name"])
    _attendee(db, popup, hider_app, hider, main, tickets=1)

    # Same tenant, but never applied to this popup → not an attendee.
    outsider = _human(db, tenant_a, "Otto", "Outsider")

    return {
        "popup": popup,
        "sharer": sharer,
        "hider": hider,
        "outsider": outsider,
    }


def test_picker_returns_name_sharing_attendee(db: Session, picker_world) -> None:
    results, total = applications_crud.find_directory_humans(
        db, popup_id=picker_world["popup"].id
    )
    ids = {h.id for h in results}
    assert picker_world["sharer"].id in ids
    assert total >= 1


def test_picker_excludes_name_hiding_attendee(db: Session, picker_world) -> None:
    results, _ = applications_crud.find_directory_humans(
        db, popup_id=picker_world["popup"].id
    )
    ids = {h.id for h in results}
    assert picker_world["hider"].id not in ids


def test_picker_excludes_non_attendee(db: Session, picker_world) -> None:
    results, _ = applications_crud.find_directory_humans(
        db, popup_id=picker_world["popup"].id
    )
    ids = {h.id for h in results}
    assert picker_world["outsider"].id not in ids


def test_picker_excludes_last_name_hider(db: Session, tenant_a: Tenants) -> None:
    """Hiding only last_name also excludes the human from the picker."""
    popup = _popup(db, tenant_a)
    main = _category(db, popup, "main", is_primary=True)
    human = _human(db, tenant_a, "Lara", "Lastless")
    app = _application(db, popup, human, info_not_shared=["last_name"])
    _attendee(db, popup, app, human, main, tickets=1)

    results, total = applications_crud.find_directory_humans(db, popup_id=popup.id)
    assert total == 0
    assert results == []


def test_picker_search_filters_by_name(db: Session, picker_world) -> None:
    results, total = applications_crud.find_directory_humans(
        db, popup_id=picker_world["popup"].id, q="Sharer"
    )
    assert total == 1
    assert results[0].id == picker_world["sharer"].id


# ---------------------------------------------------------------------------
# human_ids_hiding_name — RSVP exclusion
# ---------------------------------------------------------------------------


def test_human_ids_hiding_name_returns_only_hiders(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _popup(db, tenant_a)
    sharer = _human(db, tenant_a, "Sam", "Shares")
    hider = _human(db, tenant_a, "Hank", "Hides")
    _application(db, popup, sharer)
    _application(db, popup, hider, info_not_shared=["last_name", "telegram"])

    result = applications_crud.human_ids_hiding_name(
        db, popup.id, [sharer.id, hider.id]
    )
    assert result == {hider.id}


def test_human_ids_hiding_name_empty_input(db: Session, tenant_a: Tenants) -> None:
    popup = _popup(db, tenant_a)
    assert applications_crud.human_ids_hiding_name(db, popup.id, []) == set()


# ---------------------------------------------------------------------------
# list_portal_participants — RSVP list excludes name hiders
# ---------------------------------------------------------------------------


def _event(db: Session, popup: Popups, owner: Humans) -> Events:
    now = datetime.now(UTC)
    event = Events(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        owner_id=owner.id,
        title="Test Event",
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=1, hours=1),
        status=EventStatus.PUBLISHED,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _participant(db: Session, event: Events, human: Humans) -> EventParticipants:
    p = EventParticipants(
        id=uuid.uuid4(),
        tenant_id=event.tenant_id,
        event_id=event.id,
        profile_id=human.id,
        status=ParticipantStatus.REGISTERED,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def test_portal_participants_excludes_name_hiders(
    db: Session, tenant_a: Tenants
) -> None:
    """The portal RSVP list drops a participant who hid their name for the popup
    and keeps one who did not. Mirrors the router's filtering logic.
    """
    from app.api.event.crud import events_crud
    from app.api.event_participant.crud import event_participants_crud
    from app.api.event_participant.router import _participants_with_names

    popup = _popup(db, tenant_a)
    sharer = _human(db, tenant_a, "Vera", "Visible")
    hider = _human(db, tenant_a, "Ivy", "Invisible")
    owner = _human(db, tenant_a, "Olga", "Owner")

    _application(db, popup, sharer)
    _application(db, popup, hider, info_not_shared=["first_name"])

    event = _event(db, popup, owner)
    _participant(db, event, sharer)
    _participant(db, event, hider)

    participants, _ = event_participants_crud.find_by_event(db, event_id=event.id)

    resolved_event = events_crud.get(db, event.id)
    hidden = applications_crud.human_ids_hiding_name(
        db, resolved_event.popup_id, [p.profile_id for p in participants]
    )
    participants = [p for p in participants if p.profile_id not in hidden]

    out = _participants_with_names(db, participants)
    profile_ids = {p.profile_id for p in out}
    assert sharer.id in profile_ids
    assert hider.id not in profile_ids
