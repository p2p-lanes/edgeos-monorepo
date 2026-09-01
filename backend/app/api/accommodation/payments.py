"""Booking lifecycle hooked onto the existing payment lifecycle.

**The payment gateway is not involved here.** SimpleFI, coupons, group
discounts, installments and webhooks all behave exactly as they do for any
other product: an accommodation travels as one ``payment_products`` line on
the shadow product (see ``crud.sync_shadow_product``). What this module adds
is the four things a room needs and a normal product does not:

===================  ==============================  ============================
                     Normal product                  Accommodation
===================  ==============================  ============================
Price                fixed ``products.price``        depends on dates and rules
Stock                a counter to decrement          a (unit, date range) to hold
The thing sold       nothing else to record          a booking row
Release              restore the counter             expire the hold
===================  ==============================  ============================

So: **the client never sends a price.** It sends dates and guests; the server
re-quotes and writes the result onto the line. The shadow product's ``price``
is informative and nothing reads it to charge.

Order of operations inside a purchase:

1. :func:`resolve_lines`: validate and quote every accommodation line, before
   any money math, so the amounts already reflect the real nightly prices.
2. the existing engine builds the payment and its ``payment_products`` rows.
3. :func:`create_holds`: one ``hold`` booking per line, linked to the payment.
4. the gateway does its thing; :func:`confirm_for_payment` on approval,
   :func:`release_for_payment` on expiry or cancellation.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlmodel import Session, col, select

from app.api.accommodation.availability import (
    AccommodationUnavailableError,
    check_stay_allowed,
    confirm_bookings,
    create_booking,
    release_bookings,
)
from app.api.accommodation.constants import (
    ACCOMMODATION_STEP_TEMPLATE,
    PURCHASE_METADATA_KIND,
    BookingStatus,
)
from app.api.accommodation.crud import (
    accommodation_price_rules_crud,
)
from app.api.accommodation.models import (
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.accommodation.pricing import quote_accommodation
from app.api.accommodation.schemas import AccommodationQuote
from app.api.ticketing_step.models import TicketingSteps

# Error codes returned to the checkout. Stable strings: the portal maps them
# to copy, and a changed value silently degrades to a generic message.
ERROR_STEP_DISABLED = "accommodation_step_disabled"
ERROR_NOT_OFFERED = "accommodation_not_offered"
ERROR_UNKNOWN = "accommodation_not_found"
ERROR_BAD_METADATA = "accommodation_invalid_booking_data"
ERROR_UNAVAILABLE = "accommodation_unavailable"


@dataclass
class AccommodationStepOffer:
    """What the popup's accommodation step is willing to sell.

    ``property_ids`` empty means "every visible property": the step config
    defaults to offering all of them rather than forcing an admin to tick
    boxes before anything shows up.
    """

    enabled: bool
    property_ids: list[uuid.UUID]
    require_guest_names: bool = True

    def offers(self, property_id: uuid.UUID) -> bool:
        return not self.property_ids or property_id in self.property_ids


@dataclass
class ResolvedAccommodationLine:
    """One purchase line that turned out to be a booking."""

    index: int
    accommodation: Accommodations
    property_row: AccommodationProperties
    check_in: date
    check_out: date
    guest_count: int | None
    guests: list[dict]
    quote: AccommodationQuote

    @property
    def total(self) -> Decimal:
        return self.quote.total


def _reject(code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": code, "message": message},
    )


def is_accommodation_line(line: Any) -> bool:
    """Whether a purchase line carries booking metadata.

    The discriminator is ``purchase_metadata.kind``; nothing else about the
    line marks it, because the product it points at is an ordinary row.
    """
    metadata = getattr(line, "purchase_metadata", None)
    return bool(metadata) and metadata.get("kind") == PURCHASE_METADATA_KIND


def step_offer(session: Session, popup_id: uuid.UUID) -> AccommodationStepOffer:
    """Read what the popup's checkout is configured to offer.

    A disabled (or absent) step means the checkout does not show the section
    **and** the backend refuses the lines. Without the second half the
    restriction would be cosmetic, exactly the gap the sales-flows work
    already flagged for ``visible_if``.
    """
    step = session.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == popup_id,
            TicketingSteps.template == ACCOMMODATION_STEP_TEMPLATE,
            col(TicketingSteps.is_enabled).is_(True),
        )
    ).first()

    if step is None:
        return AccommodationStepOffer(enabled=False, property_ids=[])

    config = step.template_config or {}
    raw_ids = config.get("property_ids") or []
    property_ids: list[uuid.UUID] = []
    for value in raw_ids:
        try:
            property_ids.append(
                value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
            )
        except (ValueError, AttributeError):
            # A malformed id in the config must not open the gate wider than
            # intended, but it must not break checkout either: skip it.
            continue

    return AccommodationStepOffer(
        enabled=True,
        property_ids=property_ids,
        require_guest_names=bool(config.get("require_guest_names", True)),
    )


def _parse_date(raw: Any, field: str) -> date:
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        raise _reject(
            ERROR_BAD_METADATA, f"{field} must be a date in YYYY-MM-DD format"
        ) from None


def resolve_lines(
    session: Session,
    popup: Any,
    lines: list[Any],
) -> list[ResolvedAccommodationLine]:
    """Validate and price every accommodation line of a purchase.

    Runs **before** the money math so coupons, insurance and contribution are
    computed over real nightly totals. Raises 422 with a stable error code on
    anything the buyer could have got wrong, and 409 on a race.

    Also normalises ``purchase_metadata`` in place: dates as ISO strings, the
    resolved quote, the property id. That blob is what ends up on the payment
    line and, after approval, on the attendee's pass.
    """
    indexed = [
        (index, line) for index, line in enumerate(lines) if is_accommodation_line(line)
    ]
    if not indexed:
        return []

    offer = step_offer(session, popup.id)
    if not offer.enabled:
        raise _reject(
            ERROR_STEP_DISABLED,
            "This gathering is not selling accommodation through its checkout.",
        )

    accommodation_ids: list[uuid.UUID] = []
    for _, line in indexed:
        raw_id = (line.purchase_metadata or {}).get("accommodation_id")
        try:
            accommodation_ids.append(uuid.UUID(str(raw_id)))
        except (ValueError, TypeError, AttributeError):
            raise _reject(
                ERROR_BAD_METADATA, "accommodation_id is missing or malformed"
            ) from None

    accommodations = {
        row.id: row
        for row in session.exec(
            select(Accommodations).where(
                col(Accommodations.id).in_(accommodation_ids),
                Accommodations.popup_id == popup.id,
                col(Accommodations.deleted_at).is_(None),
            )
        ).all()
    }
    properties = (
        {
            row.id: row
            for row in session.exec(
                select(AccommodationProperties).where(
                    col(AccommodationProperties.id).in_(
                        {acc.property_id for acc in accommodations.values()}
                    )
                )
            ).all()
        }
        if accommodations
        else {}
    )

    rules_by_accommodation = accommodation_price_rules_crud.find_for_accommodations(
        session, list(accommodations)
    )
    popup_min_stay = getattr(popup, "accommodation_min_stay", None)

    resolved: list[ResolvedAccommodationLine] = []
    for position, (index, line) in enumerate(indexed):
        metadata = dict(line.purchase_metadata or {})
        accommodation = accommodations.get(accommodation_ids[position])
        if accommodation is None:
            raise _reject(
                ERROR_UNKNOWN, "That room is no longer available for this gathering."
            )

        property_row = properties.get(accommodation.property_id)
        if property_row is None or not offer.offers(property_row.id):
            raise _reject(
                ERROR_NOT_OFFERED,
                "That room is not offered in this checkout.",
            )

        # The line must point at the accommodation's own shadow product;
        # otherwise a caller could attach booking metadata to a cheap product
        # and pay that price for a room.
        if accommodation.product_id != getattr(line, "product_id", None):
            raise _reject(
                ERROR_BAD_METADATA,
                "This line does not match the room it claims to book.",
            )

        if getattr(line, "quantity", 1) != 1:
            raise _reject(
                ERROR_BAD_METADATA,
                "Book one room per line; add another line for another room.",
            )

        check_in = _parse_date(metadata.get("check_in"), "check_in")
        check_out = _parse_date(metadata.get("check_out"), "check_out")

        guests = [
            guest
            for guest in (metadata.get("guests") or [])
            if isinstance(guest, dict) and guest.get("name")
        ]
        guest_count = metadata.get("guest_count")
        if guest_count is None and guests:
            guest_count = len(guests)
        if isinstance(guest_count, str) and guest_count.isdigit():
            guest_count = int(guest_count)
        if guest_count is not None and not isinstance(guest_count, int):
            raise _reject(ERROR_BAD_METADATA, "guest_count must be a whole number")

        reason = check_stay_allowed(
            accommodation,
            check_in,
            check_out,
            popup_min_stay=popup_min_stay,
            guest_count=guest_count,
        )
        if reason:
            raise _reject(reason, f"These dates cannot be booked ({reason}).")

        if offer.require_guest_names and guest_count and len(guests) < guest_count:
            raise _reject(
                ERROR_BAD_METADATA,
                "A name is required for every guest.",
            )

        quote = quote_accommodation(
            accommodation,
            rules_by_accommodation.get(accommodation.id, []),
            check_in,
            check_out,
            tax_percentage=property_row.tax_percentage,
            currency=getattr(popup, "currency", None),
        )

        metadata.update(
            {
                "kind": PURCHASE_METADATA_KIND,
                "accommodation_id": str(accommodation.id),
                "property_id": str(property_row.id),
                # Frozen, not looked up later: this blob is the guest's
                # receipt, and it should say what they booked even after the
                # building is renamed or the room type is retired.
                "accommodation_name": accommodation.name,
                "property_name": property_row.name,
                "property_address": property_row.address,
                "check_in": check_in.isoformat(),
                "check_out": check_out.isoformat(),
                "nights": quote.night_count,
                "guest_count": guest_count,
                "guests": guests,
                "quote": quote.model_dump(mode="json"),
            }
        )
        line.purchase_metadata = metadata

        resolved.append(
            ResolvedAccommodationLine(
                index=index,
                accommodation=accommodation,
                property_row=property_row,
                check_in=check_in,
                check_out=check_out,
                guest_count=guest_count,
                guests=guests,
                quote=quote,
            )
        )

    return resolved


def line_prices(resolved: list[ResolvedAccommodationLine]) -> dict[int, Decimal]:
    """Index -> price to charge, for the engine's amount computations.

    Keyed by position rather than by product: two lines can book the *same*
    room type for different dates, and they cost different amounts.
    """
    return {line.index: line.total for line in resolved}


def create_holds(
    session: Session,
    *,
    payment_id: uuid.UUID,
    resolved: list[ResolvedAccommodationLine],
    lines: list[Any],
    hold_expires_at: datetime | None = None,
    human_id: uuid.UUID | None = None,
    buyer_name: str | None = None,
    buyer_email: str | None = None,
    confirmed: bool = False,
) -> list[Any]:
    """Reserve the rooms for a payment.

    Does not commit: the caller owns the transaction, so a failure anywhere
    in the purchase takes the holds with it. Losing the race for the last room
    surfaces as 409 rather than an ``IntegrityError``.

    ``confirmed=True`` is the zero-amount path: nothing will ever be charged,
    so there is no pending state to wait through.
    """
    bookings = []
    for entry in resolved:
        line = lines[entry.index]
        metadata = dict(line.purchase_metadata or {})
        try:
            booking = create_booking(
                session,
                accommodation=entry.accommodation,
                check_in=entry.check_in,
                check_out=entry.check_out,
                status=(BookingStatus.CONFIRMED if confirmed else BookingStatus.HOLD),
                guest_count=entry.guest_count,
                guests=entry.guests,
                primary_guest_name=(
                    entry.guests[0].get("name") if entry.guests else buyer_name
                ),
                primary_guest_email=buyer_email,
                price_snapshot=entry.quote.model_dump(mode="json"),
                hold_expires_at=None if confirmed else hold_expires_at,
                payment_id=payment_id,
                human_id=human_id,
            )
        except AccommodationUnavailableError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": ERROR_UNAVAILABLE,
                    "message": (
                        f"'{entry.accommodation.name}' was just taken for those "
                        "dates. Pick different dates or another room."
                    ),
                },
            ) from None

        metadata["booking_id"] = str(booking.id)
        metadata["unit_id"] = str(booking.unit_id)
        # The label is what the guest is told at the door; the id is not.
        unit = session.get(AccommodationUnits, booking.unit_id)
        if unit is not None:
            metadata["unit_label"] = unit.label
        line.purchase_metadata = metadata
        bookings.append(booking)

    return bookings


def attach_payment_products(
    session: Session,
    *,
    payment_id: uuid.UUID,
    bookings: list[Any],
) -> None:
    """Link each booking to the payment line that paid for it.

    Done after the ``payment_products`` rows exist. Matched on the booking id
    stored in the line's metadata, so re-ordered lines cannot cross-link.
    """
    from app.api.payment.models import PaymentProducts

    if not bookings:
        return

    rows = session.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment_id)
    ).all()
    by_booking_id = {
        (row.purchase_metadata or {}).get("booking_id"): row for row in rows
    }

    for booking in bookings:
        row = by_booking_id.get(str(booking.id))
        if row is not None:
            booking.payment_product_id = row.id
            session.add(booking)


def confirm_for_payment(session: Session, payment_id: uuid.UUID) -> None:
    """Promote a payment's holds once the gateway approves it."""
    confirm_bookings(session, payment_id)


def release_for_payment(
    session: Session,
    payment_id: uuid.UUID,
    *,
    cancelled: bool = False,
) -> None:
    """Free a payment's holds when it expires or is cancelled.

    Confirmed bookings are untouched: a refund is a separate decision, and
    silently freeing a paid room would resell it under the guest.
    """
    release_bookings(
        session,
        payment_id,
        status=BookingStatus.CANCELLED if cancelled else BookingStatus.EXPIRED,
    )


def link_attendee(
    session: Session, payment_id: uuid.UUID, attendee_id: uuid.UUID | None
) -> None:
    """Record which attendee the stay belongs to, once one exists."""
    if attendee_id is None:
        return

    from app.api.accommodation.models import AccommodationBookings

    for booking in session.exec(
        select(AccommodationBookings).where(
            AccommodationBookings.payment_id == payment_id,
            col(AccommodationBookings.attendee_id).is_(None),
        )
    ).all():
        booking.attendee_id = attendee_id
        session.add(booking)


def utcnow() -> datetime:
    return datetime.now(UTC)
