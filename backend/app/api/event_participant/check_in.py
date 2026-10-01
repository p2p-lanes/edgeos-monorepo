"""Event check-in, by QR and by the organizer's roll call: mode, window,
capacity lock, the write itself and its annulment.

The organizer shows a QR that encodes a portal URL for one event (and one
occurrence, for a recurring series). Scanning it lands the attendee on a
portal page that performs a single POST. That POST may *create* the
participation, so everything the RSVP path validates has to be validated
here too — plus a time window, which until now only existed in the UI.

SIM-106 adds the roll call on top: the same write, made by a manager for
someone else (``method=manual``), gated by the event's ``attendance_mode``
and recorded in ``event_check_ins`` so a void keeps who marked, who voided,
when, how and why.

Kept out of ``router.py`` so the endpoint stays a thin sequence of guards
and the transactional core can be unit-tested on its own.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.event.schemas import AttendanceMode
from app.api.event_participant import crud
from app.api.event_participant.check_in_crud import event_check_ins_crud
from app.api.event_participant.models import EventCheckIns, EventParticipants
from app.api.event_participant.schemas import CheckInMethod, ParticipantStatus

# Check-in window, relative to the *occurrence* being checked into (not the
# series master). Opens early enough for the queue that forms before the
# doors, closes late enough for the person who scans on the way out.
# Deliberately constants, not per-popup settings: no tenant has asked to
# tune them, and a column nobody changes is a migration plus a form field
# for nothing. Promote to event_settings the day one does.
CHECK_IN_OPENS_MINUTES_BEFORE = 30
CHECK_IN_CLOSES_MINUTES_AFTER = 120


def reject(status_code: int, code: str, message: str) -> HTTPException:
    """A machine-readable rejection.

    The portal maps ``code`` to a localized string; ``message`` is the
    English fallback for clients that don't know the code (and for logs).
    """
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def is_scheduled_occurrence(event, occurrence_start: datetime) -> bool:
    """Whether the series actually produces an instance at this instant.

    False for invented times and for dates removed via EXDATE.
    """
    from app.api.event.recurrence import expand, parse_rrule

    try:
        rule = parse_rrule(event.rrule)
    except ValueError:
        return False
    if rule is None:
        return False
    occ = _aware(occurrence_start)
    return bool(
        expand(
            dtstart=event.start_time,
            rule=rule,
            window_start=occ,
            window_end=occ,
            exdates=list(event.recurrence_exdates or []),
            max_occurrences=1,
            timezone=event.timezone,
        )
    )


def resolve_occurrence_window(
    event, occurrence_start: datetime | None
) -> tuple[datetime, datetime]:
    """Start/end of the instance being checked into.

    A recurring master's own ``start_time``/``end_time`` describe its first
    instance only, so for every other occurrence the end is derived by
    carrying the master's duration onto ``occurrence_start``.
    """
    start = _aware(event.start_time)
    end = _aware(event.end_time)
    if occurrence_start is None:
        return start, end
    occ = _aware(occurrence_start)
    return occ, occ + (end - start)


def check_in_bounds(
    window_start: datetime, window_end: datetime
) -> tuple[datetime, datetime]:
    """When marking (and voiding) opens and closes for one occurrence."""
    return (
        window_start - timedelta(minutes=CHECK_IN_OPENS_MINUTES_BEFORE),
        window_end + timedelta(minutes=CHECK_IN_CLOSES_MINUTES_AFTER),
    )


def ensure_check_in_window_open(
    window_start: datetime,
    window_end: datetime,
    *,
    now: datetime | None = None,
) -> None:
    """Reject a mark or a void that is too early or too late.

    Enforced here and not only in the UI: the QR URL is shareable, so the
    window is the only thing keeping a link from being usable weeks later.
    The roll call shares it, so attendance cannot be rewritten afterwards.
    """
    moment = now or datetime.now(UTC)
    opens_at, closes_at = check_in_bounds(window_start, window_end)
    if moment < opens_at:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "check_in_not_open",
            "Check-in for this event hasn't opened yet.",
        )
    if moment > closes_at:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "check_in_closed",
            "Check-in for this event is closed.",
        )


def human_display_name(human) -> str | None:
    """How a portal human is named in attendance history."""
    name = " ".join(filter(None, [human.first_name, human.last_name]))
    return name or human.email


def user_display_name(user) -> str | None:
    """How a backoffice user is named in attendance history."""
    return user.full_name or user.email


def ensure_attendance_mode(event, method: CheckInMethod) -> None:
    """Reject a mark the event's attendance mode does not allow.

    The QR works only in ``self_checkin``; hiding it in the UI is not
    enough, because a copied URL keeps working. The roll call works in
    ``host_rollcall`` and ``self_checkin``. ``none`` takes no attendance.
    """
    mode = event.attendance_mode or AttendanceMode.NONE
    if method == CheckInMethod.QR and mode != AttendanceMode.SELF_CHECKIN:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "qr_check_in_disabled",
            "This event doesn't take check-in by QR.",
        )
    if mode == AttendanceMode.NONE:
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "attendance_disabled",
            "This event doesn't take attendance.",
        )


def lock_event_for_capacity(db: Session, event_id: uuid.UUID) -> None:
    """Serialize seat-taking writes for one event.

    ``SELECT ... FOR UPDATE`` on the event row is held until the surrounding
    transaction commits, so a count-then-insert on ``event_participants``
    cannot interleave with another one: two simultaneous scans (or a scan
    racing an RSVP) can no longer both take the last seat.

    ``populate_existing`` refreshes the already-identity-mapped Events row,
    so the capacity read after the lock is the committed value rather than
    whatever this session loaded before waiting.
    """
    from app.api.event.models import Events

    db.exec(  # type: ignore[call-overload]
        select(Events)
        .where(Events.id == event_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()


def ensure_rsvp_eligible(
    db: Session,
    popup_id: uuid.UUID,
    human_id: uuid.UUID,
    *,
    by_organizer: bool = False,
) -> None:
    """Same gate as RSVP: an allocated ticket and no rejected application.

    Holding the QR URL is not access. Someone who could not RSVP to this
    event cannot check into it either, and an organizer cannot mark them.
    ``by_organizer`` only rewords the fallback message; the codes match.
    """
    access = crud.event_participants_crud.eligibility_by_human(
        db, popup_id, {human_id}
    )[human_id]
    if access.allowed:
        return
    if access.reason == "rejected":
        raise reject(
            status.HTTP_403_FORBIDDEN,
            "application_rejected",
            "This person's application was not accepted, so they can't be checked in."
            if by_organizer
            else "Your application was not accepted, so you can't check in to events.",
        )
    raise reject(
        status.HTTP_403_FORBIDDEN,
        "ticket_required",
        "This person needs a purchased ticket for this popup to be checked in."
        if by_organizer
        else "You need a purchased ticket for this popup to check in.",
    )


def perform_check_in(
    db: Session,
    event,
    human,
    occurrence_start: datetime | None,
    *,
    method: CheckInMethod = CheckInMethod.QR,
    actor_human_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_name: str | None = None,
) -> tuple[EventParticipants, bool, bool]:
    """Check ``human`` into ``event``, creating the participation if needed.

    Returns ``(participant, already_checked_in, created)``.

    Four cases, in the order the issue spells them out:

    * already ``checked_in`` — informational success, nothing is written and
      ``check_time`` keeps its original value. Marking twice is harmless.
    * ``registered`` — flipped to ``checked_in``. No capacity check: the seat
      was already theirs, so a now-full event must not turn them away.
    * cancelled — treated as a fresh entry, subject to eligibility and
      capacity, reusing the row (the partial unique indexes allow only one).
    * missing — created directly as ``checked_in``. No RSVP required.

    Every mark also adds an ``event_check_ins`` row in the same transaction.
    A QR scan with no explicit actor is the attendee marking themselves.

    Never sends the iTIP message the RSVP path sends: a direct check-in is
    not an invitation, and the event has already started by definition.
    """
    lock_event_for_capacity(db, event.id)

    existing = crud.event_participants_crud.get_by_event_and_profile(
        db, event.id, human.id, occurrence_start=occurrence_start
    )

    if existing is not None and existing.status == ParticipantStatus.CHECKED_IN:
        return existing, True, False

    now = datetime.now(UTC)
    if method == CheckInMethod.QR and actor_human_id is None and actor_user_id is None:
        actor_human_id = human.id
        actor_name = human_display_name(human)

    def log(participant: EventParticipants, *, had_rsvp: bool) -> None:
        db.add(
            EventCheckIns(
                tenant_id=participant.tenant_id,
                event_id=participant.event_id,
                participant_id=participant.id,
                profile_id=participant.profile_id,
                occurrence_start=participant.occurrence_start,
                method=method,
                had_rsvp=had_rsvp,
                checked_in_at=now,
                checked_in_by_human_id=actor_human_id,
                checked_in_by_user_id=actor_user_id,
                checked_in_by_name=actor_name,
            )
        )

    if existing is not None and existing.status == ParticipantStatus.REGISTERED:
        existing.status = ParticipantStatus.CHECKED_IN
        existing.check_time = now
        existing.updated_at = now
        db.add(existing)
        log(existing, had_rsvp=True)
        db.commit()
        db.refresh(existing)
        return existing, False, False

    # No active participation: this mark is taking a seat, so it has to pass
    # everything a fresh RSVP would.
    ensure_rsvp_eligible(
        db, event.popup_id, human.id, by_organizer=method == CheckInMethod.MANUAL
    )

    if occurrence_start is not None and not is_scheduled_occurrence(
        event, occurrence_start
    ):
        raise reject(
            status.HTTP_400_BAD_REQUEST,
            "occurrence_not_scheduled",
            "occurrence_start does not match a scheduled occurrence",
        )

    if event.max_participant:
        active = crud.event_participants_crud.count_active_for_event(
            db, event.id, occurrence_start=occurrence_start
        )
        if active >= event.max_participant:
            raise reject(
                status.HTTP_409_CONFLICT,
                "event_full",
                "This event is full. There are no seats left.",
            )

    if existing is not None:
        # Cancelled row — reactivate in place. ``registered_at`` is reset
        # because this is a new entry, not a resumption of the old one.
        existing.status = ParticipantStatus.CHECKED_IN
        existing.check_time = now
        existing.registered_at = now
        existing.updated_at = now
        db.add(existing)
        log(existing, had_rsvp=False)
        db.commit()
        db.refresh(existing)
        return existing, False, False

    participant = EventParticipants(
        tenant_id=human.tenant_id,
        event_id=event.id,
        profile_id=human.id,
        status=ParticipantStatus.CHECKED_IN,
        occurrence_start=occurrence_start,
        check_time=now,
        registered_at=now,
    )
    db.add(participant)
    # The history row points at the participation, so it needs its id.
    db.flush()
    log(participant, had_rsvp=False)
    db.commit()
    db.refresh(participant)
    return participant, False, True


def void_check_in(
    db: Session,
    event,
    participant: EventParticipants,
    *,
    reason: str,
    actor_human_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    actor_name: str | None = None,
) -> EventParticipants:
    """Annul someone's current check-in without erasing it.

    The history row is stamped with who voided it, when and why; nothing is
    deleted. The participation goes back to what it was before the mark:
    ``registered`` when they held an RSVP, ``cancelled`` for a walk-in, so
    the seat the walk-in took is freed.

    A ``checked_in`` participation with no history row (marked before the
    table existed, or through a backoffice status edit) gets one first, so
    the void has something to stamp. Its origin is unknown, so it is kept
    as a manual mark by nobody and treated as holding an RSVP: freeing a
    seat that may have been reserved is the worse mistake.
    """
    lock_event_for_capacity(db, event.id)
    db.refresh(participant)

    if participant.status != ParticipantStatus.CHECKED_IN:
        raise reject(
            status.HTTP_409_CONFLICT,
            "not_checked_in",
            "This person is not checked in.",
        )

    now = datetime.now(UTC)
    record = event_check_ins_crud.active_for_participant(db, participant.id)
    if record is None:
        record = EventCheckIns(
            tenant_id=participant.tenant_id,
            event_id=participant.event_id,
            participant_id=participant.id,
            profile_id=participant.profile_id,
            occurrence_start=participant.occurrence_start,
            method=CheckInMethod.MANUAL,
            had_rsvp=True,
            checked_in_at=participant.check_time or participant.updated_at,
        )

    record.voided_at = now
    record.voided_by_human_id = actor_human_id
    record.voided_by_user_id = actor_user_id
    record.voided_by_name = actor_name
    record.void_reason = reason.strip()
    db.add(record)

    participant.status = (
        ParticipantStatus.REGISTERED if record.had_rsvp else ParticipantStatus.CANCELLED
    )
    participant.check_time = None
    participant.updated_at = now
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return participant
