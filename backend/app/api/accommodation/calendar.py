"""Assembles the booking calendar the backoffice renders.

The screen is a grid: one row per unit, one column per day, bars for
bookings. Building that server-side keeps the client dumb, in particular
the per-day "Available" row, which is the number an operator actually reads
before taking a phone booking and must not be re-derived in two places.

One query per table, then the tree is stitched in memory: a popup with 200
units over a month is a few thousand rows, far cheaper than the per-room
round-trips a naive implementation would make.
"""

import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import Session, col, select

from app.api.accommodation.constants import BLOCKING_BOOKING_STATUSES, BookingStatus
from app.api.accommodation.models import (
    AccommodationBookings,
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.accommodation.schemas import (
    AccommodationCalendar,
    CalendarAccommodation,
    CalendarBooking,
    CalendarProperty,
    CalendarUnit,
)


def _booking_total(booking: AccommodationBookings) -> Decimal | None:
    snapshot = booking.price_snapshot or {}
    total = snapshot.get("total")
    return Decimal(str(total)) if total is not None else None


def _days(date_from: date, date_to: date) -> list[date]:
    return [
        date_from + timedelta(days=offset)
        for offset in range((date_to - date_from).days)
    ]


def build_calendar(
    session: Session,
    *,
    popup_id: uuid.UUID,
    date_from: date,
    date_to: date,
    property_id: uuid.UUID | None = None,
    statuses: list[str] | None = None,
) -> AccommodationCalendar:
    """Property -> room type -> unit -> bookings, for ``[date_from, date_to)``."""
    blocking = statuses or list(BLOCKING_BOOKING_STATUSES)

    property_stmt = select(AccommodationProperties).where(
        AccommodationProperties.popup_id == popup_id
    )
    if property_id:
        property_stmt = property_stmt.where(AccommodationProperties.id == property_id)
    properties = list(
        session.exec(
            property_stmt.order_by(
                col(AccommodationProperties.sort_order),
                col(AccommodationProperties.name),
            )
        ).all()
    )
    if not properties:
        return AccommodationCalendar(
            date_from=date_from, date_to=date_to, properties=[]
        )

    property_ids = [row.id for row in properties]
    accommodations = list(
        session.exec(
            select(Accommodations)
            .where(
                Accommodations.popup_id == popup_id,
                col(Accommodations.property_id).in_(property_ids),
                col(Accommodations.deleted_at).is_(None),
            )
            .order_by(col(Accommodations.sort_order), col(Accommodations.name))
        ).all()
    )
    accommodation_ids = [row.id for row in accommodations]

    units = (
        list(
            session.exec(
                select(AccommodationUnits)
                .where(col(AccommodationUnits.accommodation_id).in_(accommodation_ids))
                .order_by(
                    col(AccommodationUnits.sort_order), col(AccommodationUnits.label)
                )
            ).all()
        )
        if accommodation_ids
        else []
    )

    bookings = (
        list(
            session.exec(
                select(AccommodationBookings)
                .where(
                    col(AccommodationBookings.accommodation_id).in_(accommodation_ids),
                    col(AccommodationBookings.status).in_(blocking),
                    col(AccommodationBookings.check_in) < date_to,
                    col(AccommodationBookings.check_out) > date_from,
                )
                .order_by(col(AccommodationBookings.check_in))
            ).all()
        )
        if accommodation_ids
        else []
    )

    bookings_by_unit: dict[uuid.UUID, list[AccommodationBookings]] = defaultdict(list)
    for booking in bookings:
        bookings_by_unit[booking.unit_id].append(booking)

    units_by_accommodation: dict[uuid.UUID, list[AccommodationUnits]] = defaultdict(
        list
    )
    for unit in units:
        units_by_accommodation[unit.accommodation_id].append(unit)

    accommodations_by_property: dict[uuid.UUID, list[Accommodations]] = defaultdict(
        list
    )
    for accommodation in accommodations:
        accommodations_by_property[accommodation.property_id].append(accommodation)

    calendar_days = _days(date_from, date_to)

    calendar_properties: list[CalendarProperty] = []
    for property_row in properties:
        calendar_accommodations: list[CalendarAccommodation] = []
        for accommodation in accommodations_by_property.get(property_row.id, []):
            accommodation_units = units_by_accommodation.get(accommodation.id, [])

            calendar_units: list[CalendarUnit] = []
            # Per-day occupied counter, filled while walking the bars so the
            # "Available" row costs one pass instead of a query per day.
            occupied_per_day: dict[date, int] = dict.fromkeys(calendar_days, 0)

            for unit in accommodation_units:
                unit_bookings = bookings_by_unit.get(unit.id, [])
                for booking in unit_bookings:
                    night = max(booking.check_in, date_from)
                    end = min(booking.check_out, date_to)
                    while night < end:
                        occupied_per_day[night] += 1
                        night += timedelta(days=1)

                calendar_units.append(
                    CalendarUnit(
                        id=unit.id,
                        label=unit.label,
                        is_active=unit.is_active,
                        bookings=[
                            CalendarBooking(
                                id=booking.id,
                                unit_id=booking.unit_id,
                                accommodation_id=booking.accommodation_id,
                                kind=booking.kind,
                                status=booking.status,
                                check_in=booking.check_in,
                                check_out=booking.check_out,
                                nights=(booking.check_out - booking.check_in).days,
                                guest_count=booking.guest_count,
                                primary_guest_name=booking.primary_guest_name,
                                primary_guest_email=booking.primary_guest_email,
                                payment_id=booking.payment_id,
                                total=_booking_total(booking),
                                notes=booking.notes,
                            )
                            for booking in unit_bookings
                        ],
                    )
                )

            active_units = sum(1 for unit in accommodation_units if unit.is_active)
            calendar_accommodations.append(
                CalendarAccommodation(
                    id=accommodation.id,
                    name=accommodation.name,
                    kind=accommodation.kind,
                    guest_capacity=accommodation.guest_capacity,
                    units=calendar_units,
                    availability_by_day={
                        day.isoformat(): max(0, active_units - occupied_per_day[day])
                        for day in calendar_days
                    },
                )
            )

        calendar_properties.append(
            CalendarProperty(
                id=property_row.id,
                name=property_row.name,
                accommodations=calendar_accommodations,
            )
        )

    return AccommodationCalendar(
        date_from=date_from, date_to=date_to, properties=calendar_properties
    )


def confirmed_or_held_statuses() -> list[str]:
    """Default status filter: what actually occupies a room."""
    return [BookingStatus.HOLD.value, BookingStatus.CONFIRMED.value]
