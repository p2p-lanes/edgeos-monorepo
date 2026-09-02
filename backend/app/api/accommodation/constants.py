"""Shared constants and enums for the accommodation module.

Lodging inventory is popup-scoped and modelled in three levels:

    property (a building / hotel / camp)
      -> accommodation (a *type* of room: "Double Room", sold in the checkout)
        -> unit (a physical room like "201" or "202", which is what a
           booking occupies)

Guests buy an accommodation for a date range; the backend picks the unit.
"""

from enum import StrEnum


class AccommodationKind(StrEnum):
    """Physical shape of an accommodation type. Presentational only."""

    ROOM = "room"
    APARTMENT = "apartment"
    STUDIO = "studio"
    TENT = "tent"
    CABIN = "cabin"
    OTHER = "other"


class BedType(StrEnum):
    """Bed types listed in ``accommodations.beds``."""

    KING = "king"
    QUEEN = "queen"
    DOUBLE = "double"
    SINGLE = "single"
    BUNK = "bunk"
    SOFA = "sofa"


class BookingKind(StrEnum):
    """Why a unit is occupied.

    ``GUEST`` bookings come from the checkout (or are created manually by
    staff for comps); ``BLOCK`` / ``MAINTENANCE`` are internal and never
    carry a payment.
    """

    GUEST = "guest"
    BLOCK = "block"
    MAINTENANCE = "maintenance"


class BookingStatus(StrEnum):
    """Lifecycle of a booking.

    ``HOLD`` and ``CONFIRMED`` are the *blocking* states: they are the ones
    covered by the exclusion constraint, so only those two occupy a unit.
    """

    HOLD = "hold"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


#: Statuses that occupy a unit (must mirror the partial exclusion constraint
#: ``uq_accommodation_bookings_no_overlap``; see the PR 1 migration).
BLOCKING_BOOKING_STATUSES: tuple[str, ...] = (
    BookingStatus.HOLD.value,
    BookingStatus.CONFIRMED.value,
)

#: ``products.managed_by`` marker for the shadow product backing every
#: accommodation. Products carrying it are hidden from the product list and
#: are never editable by hand.
PRODUCT_MANAGED_BY_ACCOMMODATION = "accommodation"

#: ``purchase_metadata.kind`` discriminator on payment lines that carry a
#: booking. Payment code branches on this value and nothing else.
PURCHASE_METADATA_KIND = "accommodation_booking"

#: Ticketing-step template that offers accommodations in the checkout. The step
#: reuses the seeded ``housing`` step_type; only the template is new, so the
#: legacy ``housing-date`` template keeps working untouched. A popup without an
#: **enabled** step on this template cannot sell accommodations at all: the
#: check is enforced server-side, not just in the UI.
ACCOMMODATION_STEP_TEMPLATE = "accommodation-booking"
HOUSING_STEP_TYPE = "housing"

#: Price rule labels reported by the quote breakdown.
RULE_DEFAULT = "default"
RULE_LONG_STAY = "long_stay"
RULE_RANGE_PREFIX = "range:"

#: Fallback minimum stay when neither the accommodation nor the popup set one.
DEFAULT_MIN_STAY_NIGHTS = 1
