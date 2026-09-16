"""CSV export of bookings.

The audience is the property owner, not EdgeOS: they get guest names, dates,
the unit and the money, and nothing internal. Same filters as the calendar
and the bookings tab, so "export what I'm looking at" is literally the same
query.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date
from typing import Any

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


@dataclass(frozen=True)
class _AnswerColumn:
    """One column of guest-form answers.

    ``guest_index`` is ``None`` for the booking contact and the zero-based
    occupant otherwise, which is exactly how the answers are stored.
    """

    header: str
    key: str
    guest_index: int | None


def _fields(section: Any) -> list[dict[str, Any]]:
    if not isinstance(section, dict):
        return []
    fields = section.get("fields")
    return [field for field in fields if isinstance(field, dict)] if fields else []


def _snapshot_fields(snapshot: Any) -> tuple[list[dict], list[dict]]:
    """The booker fields and the per-guest fields of one stored form.

    Resolves ``mode`` the way the checkout did when it asked the questions,
    so a form saved as "the same questions" exports the same columns it
    collected rather than an empty set.
    """
    if not isinstance(snapshot, dict):
        return [], []
    booker = _fields(snapshot.get("booker"))
    guests_section = snapshot.get("guests")
    mode = (
        guests_section.get("mode", "same_as_booker")
        if isinstance(guests_section, dict)
        else "same_as_booker"
    )
    if mode == "off":
        return booker, []
    if mode == "custom":
        return booker, _fields(guests_section)
    return booker, booker


def answer_columns(bookings: list[AccommodationBookings]) -> list[_AnswerColumn]:
    """The answer columns this particular export needs.

    Derived from the snapshots the bookings carry, not from whatever the step
    asks today: the point of the snapshot is that a stay exported months
    later is labelled with the question it was actually asked. When two
    bookings disagree about a key's label, the first one wins, which keeps
    the header stable for the overwhelmingly common case of one form.

    Guest columns repeat per occupant, bounded by the largest party in the
    set, so a CSV of studios does not carry columns for a guest six.
    """
    booker_labels: dict[str, str] = {}
    guest_labels: dict[str, str] = {}
    for booking in bookings:
        booker, per_guest = _snapshot_fields(booking.form_snapshot)
        for field in booker:
            booker_labels.setdefault(field.get("key", ""), field.get("label", ""))
        for field in per_guest:
            guest_labels.setdefault(field.get("key", ""), field.get("label", ""))
    booker_labels.pop("", None)
    guest_labels.pop("", None)

    columns = [
        _AnswerColumn(f"Booking contact: {label or key}", key, None)
        for key, label in booker_labels.items()
    ]
    if not guest_labels:
        return columns

    most_guests = max(
        (len(booking.guests or []) for booking in bookings),
        default=0,
    )
    for index in range(most_guests):
        columns.extend(
            _AnswerColumn(f"Guest {index + 1}: {label or key}", key, index)
            for key, label in guest_labels.items()
        )
    return columns


def _answer(booking: AccommodationBookings, column: _AnswerColumn) -> str:
    if column.guest_index is None:
        answers = booking.booker_answers or {}
    else:
        guests = booking.guests or []
        if column.guest_index >= len(guests):
            return ""
        guest = guests[column.guest_index]
        answers = guest.get("answers") or {} if isinstance(guest, dict) else {}

    value = answers.get(column.key)
    if value is None:
        return ""
    if isinstance(value, bool):
        # "Yes"/"No", not "True"/"False": the audience is a front desk, and a
        # ticked consent box is not a Python literal.
        return "Yes" if value else "No"
    if isinstance(value, list):
        return "; ".join(str(item) for item in value)
    return str(value)


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

    # The header is no longer fixed: what a property asked its guests is part
    # of what the owner is owed, and it differs per export.
    answers = answer_columns(bookings)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(CSV_COLUMNS + [column.header for column in answers])

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
                *(_answer(booking, column) for column in answers),
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
