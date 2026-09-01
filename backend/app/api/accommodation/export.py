"""CSV export of bookings.

The audience is the property owner, not EdgeOS: they get guest names, dates,
the unit and the money, and nothing internal. Same filters as the calendar
and the bookings tab, so "export what I'm looking at" is literally the same
query.
"""

import csv
import io
from datetime import date

from sqlmodel import Session, col, select

from app.api.accommodation.models import (
    AccommodationBookings,
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)

CSV_COLUMNS = [
    "booking_id",
    "status",
    "kind",
    "property",
    "accommodation",
    "unit",
    "check_in",
    "check_out",
    "nights",
    "primary_guest",
    "guest_count",
    "guests",
    "email",
    "subtotal",
    "tax",
    "total",
    "currency",
    "payment_id",
    "created_at",
]


def export_bookings_csv(
    session: Session,
    bookings: list[AccommodationBookings],
    *,
    include_amounts: bool = True,
) -> str:
    """Render bookings as CSV.

    ``include_amounts=False`` is what a partner share link uses: the owner
    sees who arrives when, not what EdgeOS charged for it.
    """
    accommodation_ids = {booking.accommodation_id for booking in bookings}
    unit_ids = {booking.unit_id for booking in bookings}

    accommodations = {
        row.id: row
        for row in (
            session.exec(
                select(Accommodations).where(
                    col(Accommodations.id).in_(accommodation_ids)
                )
            ).all()
            if accommodation_ids
            else []
        )
    }
    properties = {
        row.id: row
        for row in (
            session.exec(
                select(AccommodationProperties).where(
                    col(AccommodationProperties.id).in_(
                        {acc.property_id for acc in accommodations.values()}
                    )
                )
            ).all()
            if accommodations
            else []
        )
    }
    units = {
        row.id: row
        for row in (
            session.exec(
                select(AccommodationUnits).where(
                    col(AccommodationUnits.id).in_(unit_ids)
                )
            ).all()
            if unit_ids
            else []
        )
    }

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS)

    for booking in bookings:
        accommodation = accommodations.get(booking.accommodation_id)
        property_row = (
            properties.get(accommodation.property_id) if accommodation else None
        )
        unit = units.get(booking.unit_id)
        snapshot = booking.price_snapshot or {}
        guests = booking.guests or []

        writer.writerow(
            [
                str(booking.id),
                booking.status,
                booking.kind,
                property_row.name if property_row else "",
                accommodation.name if accommodation else "",
                unit.label if unit else "",
                booking.check_in.isoformat(),
                booking.check_out.isoformat(),
                (booking.check_out - booking.check_in).days,
                booking.primary_guest_name or "",
                booking.guest_count or "",
                "; ".join(
                    guest.get("name", "") for guest in guests if isinstance(guest, dict)
                ),
                booking.primary_guest_email or "",
                snapshot.get("subtotal", "") if include_amounts else "",
                snapshot.get("tax", "") if include_amounts else "",
                snapshot.get("total", "") if include_amounts else "",
                snapshot.get("currency", "") if include_amounts else "",
                str(booking.payment_id) if booking.payment_id else "",
                booking.created_at.isoformat() if booking.created_at else "",
            ]
        )

    return output.getvalue()


def export_filename(
    popup_slug: str | None, date_from: date | None, date_to: date | None
) -> str:
    parts = ["bookings"]
    if popup_slug:
        parts.append(popup_slug)
    if date_from and date_to:
        parts.append(f"{date_from.isoformat()}_{date_to.isoformat()}")
    return "-".join(parts) + ".csv"
