"""Organizer roll call for an event occurrence (SIM-106).

Shared by the portal (the event's owner, assigned host and collaborators)
and the backoffice (operators). The routers only decide *who* is calling;
everything about *what* may happen lives here, so both surfaces enforce the
same mode, window, eligibility, visibility and capacity rules as the QR.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, func, select

from app.api.event.schemas import AttendanceMode, EventStatus
from app.api.event_participant import crud
from app.api.event_participant.check_in import (
    check_in_bounds,
    ensure_attendance_mode,
    ensure_check_in_window_open,
    lock_event_for_capacity,
    perform_check_in,
    reject,
    resolve_occurrence_window,
    void_check_in,
)
from app.api.event_participant.check_in_crud import event_check_ins_crud
from app.api.event_participant.models import EventCheckIns, EventParticipants
from app.api.event_participant.schemas import (
    AttendanceActor,
    AttendanceCheckInRecord,
    AttendanceEntry,
    AttendanceLookupResult,
    AttendanceRoster,
    AttendanceWindow,
    CheckInMethod,
    ManualCheckInResult,
    ParticipantStatus,
)

# A roll call is read in one go; an occurrence with more seats than this is
# not something any tenant runs.
_ROSTER_LIMIT = 5000


def resolve_attendance_occurrence(
    event, occurrence_start: datetime | None
) -> datetime | None:
    """Recurring series need the occurrence; one-offs must not carry one."""
    if event.rrule and occurrence_start is None:
        raise reject(
            status.HTTP_400_BAD_REQUEST,
            "occurrence_required",
            "Choose which date of this recurring event to take attendance for.",
        )
    if not event.rrule and occurrence_start is not None:
        raise reject(
            status.HTTP_400_BAD_REQUEST,
            "occurrence_not_scheduled",
            "This event has a single date.",
        )
    return occurrence_start


def _actor(
    human_id: uuid.UUID | None, user_id: uuid.UUID | None, name: str | None
) -> AttendanceActor:
    if human_id is not None:
        return AttendanceActor(kind="human", id=human_id, name=name)
    if user_id is not None:
        return AttendanceActor(kind="user", id=user_id, name=name)
    return AttendanceActor(kind="unknown")


def _record(r: EventCheckIns) -> AttendanceCheckInRecord:
    return AttendanceCheckInRecord(
        id=r.id,
        method=r.method,
        had_rsvp=r.had_rsvp,
        checked_in_at=r.checked_in_at,
        checked_in_by=_actor(
            r.checked_in_by_human_id, r.checked_in_by_user_id, r.checked_in_by_name
        ),
        voided_at=r.voided_at,
        voided_by=_actor(r.voided_by_human_id, r.voided_by_user_id, r.voided_by_name)
        if r.voided_at is not None
        else None,
        void_reason=r.void_reason,
    )


def _serialize_entries(
    db: Session, participants: list[EventParticipants]
) -> list[AttendanceEntry]:
    """Participants plus names, emails and full history, in two queries."""
    from app.api.human.models import Humans

    if not participants:
        return []
    history = event_check_ins_crud.list_for_participants(
        db, {p.id for p in participants}
    )
    humans = {
        h.id: h
        for h in db.exec(
            select(Humans).where(
                Humans.id.in_({p.profile_id for p in participants})  # type: ignore[attr-defined]
            )
        ).all()
    }
    out: list[AttendanceEntry] = []
    for p in participants:
        human = humans.get(p.profile_id)
        out.append(
            AttendanceEntry(
                participant_id=p.id,
                profile_id=p.profile_id,
                first_name=human.first_name if human else None,
                last_name=human.last_name if human else None,
                email=human.email if human else None,
                status=p.status,
                check_time=p.check_time,
                history=[_record(r) for r in history.get(p.id, [])],
            )
        )
    return out


def build_roster(
    db: Session, event, occurrence_start: datetime | None
) -> AttendanceRoster:
    """Everyone holding a seat in the occurrence, plus anyone with history.

    Cancelled participations are left out unless they carry attendance
    history (a voided walk-in), so the organizer can still see what was
    corrected. The host is never on the list: they run the event.
    """
    participants, _ = crud.event_participants_crud.find_by_event(
        db,
        event_id=event.id,
        skip=0,
        limit=_ROSTER_LIMIT,
        occurrence_start=occurrence_start,
        scope_to_occurrence=True,
        exclude_profile_id=event.host_id,
    )
    with_history = set(
        db.exec(
            select(EventCheckIns.participant_id).where(
                EventCheckIns.participant_id.in_(  # type: ignore[attr-defined]
                    [p.id for p in participants]
                )
            )
        ).all()
    )
    shown = [
        p
        for p in participants
        if p.status != ParticipantStatus.CANCELLED or p.id in with_history
    ]
    entries = _serialize_entries(db, shown)
    # Checked in first, then by name, so the roll call reads top-down.
    entries.sort(
        key=lambda e: (
            e.status != ParticipantStatus.CHECKED_IN,
            e.status == ParticipantStatus.CANCELLED,
            (e.first_name or "").lower(),
            (e.last_name or "").lower(),
        )
    )

    window_start, window_end = resolve_occurrence_window(event, occurrence_start)
    opens_at, closes_at = check_in_bounds(window_start, window_end)
    now = datetime.now(UTC)
    return AttendanceRoster(
        event_id=event.id,
        occurrence_start=occurrence_start,
        attendance_mode=event.attendance_mode or AttendanceMode.NONE,
        window=AttendanceWindow(
            opens_at=opens_at,
            closes_at=closes_at,
            is_open=opens_at <= now <= closes_at,
        ),
        max_participant=event.max_participant,
        seats_taken=sum(1 for p in shown if p.status != ParticipantStatus.CANCELLED),
        checked_in_count=sum(
            1 for p in shown if p.status == ParticipantStatus.CHECKED_IN
        ),
        entries=entries,
    )


def lookup_by_email(
    db: Session, event, occurrence_start: datetime | None, email: str
) -> AttendanceLookupResult:
    """Find one person by exact email, for a walk-in.

    Only people who could actually be checked in come back: someone with a
    participation in this occurrence, or someone with a ticket for the
    popup and no rejected application. Everyone else, including an email
    that matches nobody, gets the same 404, so the search reveals neither
    who has an account nor who was rejected.
    """
    from app.api.human.models import Humans

    normalized = email.strip().lower()
    if not normalized:
        raise reject(
            status.HTTP_404_NOT_FOUND,
            "attendee_not_found",
            "No one who can attend matches that email.",
        )
    human = db.exec(
        select(Humans).where(func.lower(Humans.email) == normalized)
    ).first()
    not_found = reject(
        status.HTTP_404_NOT_FOUND,
        "attendee_not_found",
        "No one who can attend matches that email.",
    )
    if human is None or human.id == event.host_id:
        raise not_found

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, event.id, human.id, occurrence_start=occurrence_start
    )
    active = existing is not None and existing.status != ParticipantStatus.CANCELLED
    if not active:
        access = crud.event_participants_crud.eligibility_by_human(
            db, event.popup_id, {human.id}
        )[human.id]
        if not access.allowed:
            raise not_found
    return AttendanceLookupResult(
        profile_id=human.id,
        first_name=human.first_name,
        last_name=human.last_name,
        email=human.email,
        status=existing.status if existing is not None else None,
    )


def _ensure_event_takes_attendance(db: Session, event) -> None:
    """The event-level gates a mark shares with the QR."""
    from app.api.event_settings.crud import event_settings_crud
    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, event.popup_id))
    settings = event_settings_crud.get_by_popup_id(db, event.popup_id)
    if settings and not settings.event_enabled:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "events_disabled",
            "Events are disabled for this popup.",
        )
    if event.status != EventStatus.PUBLISHED:
        raise reject(
            status.HTTP_400_BAD_REQUEST,
            "event_not_published",
            "This event is not published.",
        )


def manual_check_in(
    db: Session,
    event,
    profile_id: uuid.UUID,
    occurrence_start: datetime | None,
    *,
    actor_human_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_name: str | None = None,
) -> ManualCheckInResult:
    """Mark someone present from the roll call.

    Same rules as the QR: published event, writable popup, events enabled,
    the event visible to the person, the time window, and for anyone
    without an RSVP, eligibility and a free seat, all under the event lock.
    """
    from app.api.human.models import Humans
    from app.services.event_visibility import ensure_event_visible_to_human

    _ensure_event_takes_attendance(db, event)
    ensure_attendance_mode(event, CheckInMethod.MANUAL)
    occ = resolve_attendance_occurrence(event, occurrence_start)

    human = db.get(Humans, profile_id)
    if human is None:
        raise reject(
            status.HTTP_404_NOT_FOUND,
            "attendee_not_found",
            "No one who can attend matches that person.",
        )
    if human.id == event.host_id:
        raise reject(
            status.HTTP_409_CONFLICT,
            "event_host_cannot_attend",
            "Event hosts cannot check in as participants.",
        )
    try:
        ensure_event_visible_to_human(db, event, human)
    except HTTPException as exc:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "attendee_not_invited",
            "This person isn't invited to this private event.",
        ) from exc

    window_start, window_end = resolve_occurrence_window(event, occ)
    ensure_check_in_window_open(window_start, window_end)

    participant, already, created = perform_check_in(
        db,
        event,
        human,
        occ,
        method=CheckInMethod.MANUAL,
        actor_human_id=actor_human_id,
        actor_user_id=actor_user_id,
        actor_name=actor_name,
    )
    if not already:
        from app.api.badge.rules import evaluate_after_check_in

        evaluate_after_check_in(db, human.id, event)
    return ManualCheckInResult(
        entry=_serialize_entries(db, [participant])[0],
        already_checked_in=already,
        created=created,
    )


def manual_void(
    db: Session,
    event,
    profile_id: uuid.UUID,
    occurrence_start: datetime | None,
    reason: str,
    *,
    actor_human_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_name: str | None = None,
) -> AttendanceEntry:
    """Annul someone's check-in, QR or manual, inside the window.

    Not gated on the attendance mode: a mode change keeps every record, and
    a mark made in any mode must stay correctable while the window is open.
    """
    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, event.popup_id))
    occ = resolve_attendance_occurrence(event, occurrence_start)
    if not reason.strip():
        raise reject(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "void_reason_required",
            "Say why this check-in is being voided.",
        )

    window_start, window_end = resolve_occurrence_window(event, occ)
    ensure_check_in_window_open(window_start, window_end)

    participant = crud.event_participants_crud.get_by_event_and_profile(
        db, event.id, profile_id, occurrence_start=occ
    )
    if participant is None:
        raise reject(
            status.HTTP_409_CONFLICT,
            "not_checked_in",
            "This person is not checked in.",
        )
    participant = void_check_in(
        db,
        event,
        participant,
        reason=reason,
        actor_human_id=actor_human_id,
        actor_user_id=actor_user_id,
        actor_name=actor_name,
    )
    return _serialize_entries(db, [participant])[0]


def set_attendance_mode(db: Session, event, mode: AttendanceMode) -> bool:
    """Change how attendance is taken. Returns whether anything changed.

    Moving between ``host_rollcall`` and ``self_checkin`` keeps every record:
    attendance lives on the participations, not on the mode. Going back to
    ``none`` is refused once the event has any check-in, in any occurrence,
    voided or not, because the event already has attendance to account for.
    """
    current = event.attendance_mode or AttendanceMode.NONE
    if mode == current:
        return False
    if mode == AttendanceMode.NONE:
        # Serialize against a check-in landing between the read and the write.
        lock_event_for_capacity(db, event.id)
        if event_check_ins_crud.event_has_any_check_in(db, event.id):
            raise reject(
                status.HTTP_409_CONFLICT,
                "attendance_mode_locked",
                "This event already has check-ins, so attendance can't be turned off.",
            )
    event.attendance_mode = mode
    event.updated_at = datetime.now(UTC)
    db.add(event)
    db.commit()
    db.refresh(event)
    return True
