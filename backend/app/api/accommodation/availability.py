"""Availability, unit assignment and booking creation.

Two rules govern this file:

1. **The database decides.** ``uq_accommodation_bookings_no_overlap`` (a GiST
   exclusion constraint over ``unit_id`` + ``daterange(check_in, check_out)``
   restricted to ``hold``/``confirmed``) is what actually prevents a double
   booking. Everything here is best-effort selection on top of it, plus a
   retry loop so a lost race surfaces as a clean 409 instead of an
   ``IntegrityError``.
2. **Half-open ranges.** A stay occupies ``[check_in, check_out)``, so a
   guest leaving on the 8th and one arriving on the 8th do not collide.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, and_, col, or_, select

from app.api.accommodation.constants import (
    BLOCKING_BOOKING_STATUSES,
    DEFAULT_MIN_STAY_NIGHTS,
    BookingKind,
    BookingStatus,
)
from app.api.accommodation.models import (
    AccommodationBookings,
    Accommodations,
    AccommodationUnits,
)

# ``unavailable_reason`` values returned to the checkout so the UI can explain
# a zero instead of just greying the card out.
REASON_INACTIVE = "inactive"
REASON_OUTSIDE_WINDOW = "outside_bookable_window"
REASON_MIN_STAY = "min_stay_not_met"
REASON_SOLD_OUT = "sold_out"
REASON_OVER_CAPACITY = "over_capacity"

#: How many candidate units one hold will try before giving up. Each attempt
#: is a different unit, so this only caps pathological contention; a normal
#: checkout succeeds on the first.
MAX_ASSIGNMENT_ATTEMPTS = 10


class AccommodationUnavailableError(Exception):
    """No unit of this accommodation is free for the requested range."""

    def __init__(self, accommodation_id: uuid.UUID) -> None:
        self.accommodation_id = accommodation_id
        super().__init__(f"No unit available for accommodation {accommodation_id}")


class StayNotAllowedError(Exception):
    """The requested range violates a restriction (window, min stay, capacity)."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class _Neighbour:
    """Bookings adjacent to the requested range on one candidate unit."""

    previous_end: date | None
    next_start: date | None


def effective_min_stay(
    accommodation: Accommodations, popup_min_stay: int | None
) -> int:
    """Per-accommodation override, else the popup default, else 1 night."""
    if accommodation.min_stay_override:
        return accommodation.min_stay_override
    if popup_min_stay:
        return popup_min_stay
    return DEFAULT_MIN_STAY_NIGHTS


def check_stay_allowed(
    accommodation: Accommodations,
    check_in: date,
    check_out: date,
    *,
    popup_min_stay: int | None = None,
    guest_count: int | None = None,
) -> str | None:
    """Validate a stay against the accommodation's own restrictions.

    Returns the ``REASON_*`` that blocks it, or ``None`` when it is allowed.
    Availability is *not* checked here: that needs the database.
    """
    if not accommodation.is_active or accommodation.deleted_at is not None:
        return REASON_INACTIVE

    if check_out <= check_in:
        return REASON_MIN_STAY

    if check_in < accommodation.bookable_from or check_out > accommodation.bookable_to:
        return REASON_OUTSIDE_WINDOW

    nights = (check_out - check_in).days
    if nights < effective_min_stay(accommodation, popup_min_stay):
        return REASON_MIN_STAY

    if guest_count is not None and guest_count > accommodation.guest_capacity:
        return REASON_OVER_CAPACITY

    return None


def _overlapping_bookings_condition(check_in: date, check_out: date):
    """Half-open overlap: ``existing.check_in < check_out < existing.check_out``."""
    return and_(
        col(AccommodationBookings.status).in_(BLOCKING_BOOKING_STATUSES),
        col(AccommodationBookings.check_in) < check_out,
        col(AccommodationBookings.check_out) > check_in,
    )


def occupied_unit_ids(
    session: Session,
    accommodation_ids: Sequence[uuid.UUID],
    check_in: date,
    check_out: date,
    *,
    exclude_booking_id: uuid.UUID | None = None,
) -> set[uuid.UUID]:
    """Units of the given accommodations that are taken for the range."""
    if not accommodation_ids:
        return set()

    statement = select(AccommodationBookings.unit_id).where(
        col(AccommodationBookings.accommodation_id).in_(accommodation_ids),
        _overlapping_bookings_condition(check_in, check_out),
    )
    if exclude_booking_id is not None:
        statement = statement.where(AccommodationBookings.id != exclude_booking_id)

    return set(session.exec(statement).all())


def available_units(
    session: Session,
    accommodation_id: uuid.UUID,
    check_in: date,
    check_out: date,
    *,
    exclude_booking_id: uuid.UUID | None = None,
) -> list[AccommodationUnits]:
    """Free, active units of one accommodation, in assignment order.

    Read-only and lock-free: this answers "how many are left" for the UI. The
    locking happens one unit at a time in :func:`create_booking`.
    """
    taken = occupied_unit_ids(
        session,
        [accommodation_id],
        check_in,
        check_out,
        exclude_booking_id=exclude_booking_id,
    )

    statement = select(AccommodationUnits).where(
        AccommodationUnits.accommodation_id == accommodation_id,
        col(AccommodationUnits.is_active).is_(True),
    )
    if taken:
        statement = statement.where(col(AccommodationUnits.id).notin_(taken))

    statement = statement.order_by(
        col(AccommodationUnits.sort_order), col(AccommodationUnits.label)
    )
    return list(session.exec(statement).all())


def count_available(
    session: Session,
    accommodation_id: uuid.UUID,
    check_in: date,
    check_out: date,
) -> int:
    """How many units are bookable: the "3 left" badge in the checkout."""
    return len(available_units(session, accommodation_id, check_in, check_out))


def availability_by_accommodation(
    session: Session,
    accommodation_ids: Sequence[uuid.UUID],
    check_in: date,
    check_out: date,
) -> dict[uuid.UUID, int]:
    """Bulk availability for a whole checkout screen in two queries.

    The per-accommodation helper is fine for a single card, but the portal
    asks for every room type at once on each date change; doing that one
    accommodation at a time is an N+1 on the hot path.
    """
    if not accommodation_ids:
        return {}

    taken = occupied_unit_ids(session, accommodation_ids, check_in, check_out)

    units = session.exec(
        select(AccommodationUnits).where(
            col(AccommodationUnits.accommodation_id).in_(accommodation_ids),
            col(AccommodationUnits.is_active).is_(True),
        )
    ).all()

    counts: dict[uuid.UUID, int] = dict.fromkeys(accommodation_ids, 0)
    for unit in units:
        if unit.id not in taken:
            counts[unit.accommodation_id] = counts.get(unit.accommodation_id, 0) + 1
    return counts


def _neighbours(
    session: Session,
    unit_ids: Sequence[uuid.UUID],
    check_in: date,
    check_out: date,
) -> dict[uuid.UUID, _Neighbour]:
    """Closest blocking booking before and after the range, per unit."""
    neighbours: dict[uuid.UUID, _Neighbour] = {
        unit_id: _Neighbour(None, None) for unit_id in unit_ids
    }
    if not unit_ids:
        return neighbours

    rows = session.exec(
        select(AccommodationBookings).where(
            col(AccommodationBookings.unit_id).in_(unit_ids),
            col(AccommodationBookings.status).in_(BLOCKING_BOOKING_STATUSES),
            or_(
                col(AccommodationBookings.check_out) <= check_in,
                col(AccommodationBookings.check_in) >= check_out,
            ),
        )
    ).all()

    for booking in rows:
        current = neighbours[booking.unit_id]
        if booking.check_out <= check_in:
            if current.previous_end is None or booking.check_out > current.previous_end:
                neighbours[booking.unit_id] = _Neighbour(
                    booking.check_out, current.next_start
                )
        elif booking.check_in >= check_out:
            if current.next_start is None or booking.check_in < current.next_start:
                neighbours[booking.unit_id] = _Neighbour(
                    current.previous_end, booking.check_in
                )

    return neighbours


#: Gap used when a unit has no neighbouring booking on that side. Large enough
#: to always lose against a real adjacency, small enough to stay an int.
_NO_NEIGHBOUR_GAP = 10_000


def rank_units_best_fit(
    session: Session,
    units: Sequence[AccommodationUnits],
    check_in: date,
    check_out: date,
) -> list[AccommodationUnits]:
    """Order candidate units so the tightest gap is filled first.

    Packing stays against existing bookings keeps long uninterrupted holes
    open for long stays, which is the difference between selling a 3-week
    booking and having it scattered across four half-free rooms.
    """
    neighbours = _neighbours(session, [unit.id for unit in units], check_in, check_out)

    def score(unit: AccommodationUnits) -> tuple[int, int, str]:
        neighbour = neighbours[unit.id]
        before = (
            (check_in - neighbour.previous_end).days
            if neighbour.previous_end is not None
            else _NO_NEIGHBOUR_GAP
        )
        after = (
            (neighbour.next_start - check_out).days
            if neighbour.next_start is not None
            else _NO_NEIGHBOUR_GAP
        )
        return (before + after, unit.sort_order, unit.label)

    return sorted(units, key=score)


def _try_lock_unit(session: Session, unit_id: uuid.UUID) -> bool:
    """Take a row lock on one unit, or report that someone else holds it.

    Locking candidates *one at a time* matters: locking the whole candidate
    set with ``SKIP LOCKED`` would make the first buyer hide every free unit
    from the second, who would then be told the room type is sold out while
    rooms sit empty.
    """
    return (
        session.exec(
            select(AccommodationUnits.id)
            .where(AccommodationUnits.id == unit_id)
            .with_for_update(skip_locked=True)
        ).first()
        is not None
    )


def create_booking(
    session: Session,
    *,
    accommodation: Accommodations,
    check_in: date,
    check_out: date,
    status: BookingStatus = BookingStatus.HOLD,
    kind: BookingKind = BookingKind.GUEST,
    unit_id: uuid.UUID | None = None,
    guest_count: int | None = None,
    guests: list[dict] | None = None,
    primary_guest_name: str | None = None,
    primary_guest_email: str | None = None,
    price_snapshot: dict | None = None,
    hold_expires_at: datetime | None = None,
    payment_id: uuid.UUID | None = None,
    payment_product_id: uuid.UUID | None = None,
    human_id: uuid.UUID | None = None,
    attendee_id: uuid.UUID | None = None,
    notes: str | None = None,
    created_by_user_id: uuid.UUID | None = None,
) -> AccommodationBookings:
    """Assign a unit and insert the booking, retrying on a lost race.

    Does **not** commit: the caller owns the transaction, because a checkout
    creates the payment and its holds atomically. Each attempt runs inside a
    savepoint so a constraint violation rolls back only that insert.
    """
    candidates: list[AccommodationUnits]
    pinned = unit_id is not None
    if unit_id is not None:
        unit = session.get(AccommodationUnits, unit_id)
        if unit is None or unit.accommodation_id != accommodation.id:
            raise AccommodationUnavailableError(accommodation.id)
        candidates = [unit]
    else:
        free = available_units(session, accommodation.id, check_in, check_out)
        candidates = rank_units_best_fit(session, free, check_in, check_out)

    if not candidates:
        raise AccommodationUnavailableError(accommodation.id)

    last_error: IntegrityError | None = None
    for candidate in candidates[:MAX_ASSIGNMENT_ATTEMPTS]:
        # A pinned unit is inserted straight away: the caller asked for that
        # room specifically, so the constraint should decide, not a lock we
        # would only have to release.
        if not pinned and not _try_lock_unit(session, candidate.id):
            continue

        booking = AccommodationBookings(
            tenant_id=accommodation.tenant_id,
            popup_id=accommodation.popup_id,
            accommodation_id=accommodation.id,
            unit_id=candidate.id,
            kind=kind,
            status=status,
            check_in=check_in,
            check_out=check_out,
            guest_count=guest_count,
            guests=guests or [],
            primary_guest_name=primary_guest_name,
            primary_guest_email=primary_guest_email,
            price_snapshot=price_snapshot,
            hold_expires_at=hold_expires_at,
            payment_id=payment_id,
            payment_product_id=payment_product_id,
            human_id=human_id,
            attendee_id=attendee_id,
            notes=notes,
            created_by_user_id=created_by_user_id,
        )
        savepoint = session.begin_nested()
        try:
            session.add(booking)
            session.flush()
        except IntegrityError as exc:
            savepoint.rollback()
            last_error = exc
            continue
        else:
            savepoint.commit()
            return booking

    # Every candidate lost the race (or the caller pinned a unit that is now
    # taken). Surfacing this as a domain error keeps the 409 clean.
    raise AccommodationUnavailableError(accommodation.id) from last_error


def release_bookings(
    session: Session,
    payment_id: uuid.UUID,
    *,
    status: BookingStatus = BookingStatus.EXPIRED,
) -> int:
    """Free the holds of a payment that expired or was cancelled."""
    bookings = session.exec(
        select(AccommodationBookings).where(
            AccommodationBookings.payment_id == payment_id,
            AccommodationBookings.status == BookingStatus.HOLD,
        )
    ).all()

    for booking in bookings:
        booking.status = status
        booking.hold_expires_at = None
        session.add(booking)

    return len(bookings)


def confirm_bookings(
    session: Session, payment_id: uuid.UUID
) -> list[AccommodationBookings]:
    """Promote a payment's holds to confirmed once the gateway approves."""
    bookings = session.exec(
        select(AccommodationBookings).where(
            AccommodationBookings.payment_id == payment_id,
            col(AccommodationBookings.status).in_(
                [BookingStatus.HOLD, BookingStatus.CONFIRMED]
            ),
        )
    ).all()

    confirmed: list[AccommodationBookings] = []
    for booking in bookings:
        booking.status = BookingStatus.CONFIRMED
        booking.hold_expires_at = None
        session.add(booking)
        confirmed.append(booking)

    return confirmed
