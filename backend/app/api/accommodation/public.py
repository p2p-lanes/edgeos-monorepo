"""What the portal is allowed to see.

Two reads, both anonymous: the inventory on offer, and what it costs for a
set of dates. Neither writes anything: a room is only ever held by the
payment, which is where :mod:`app.api.accommodation.payments` takes over.

Both refuse when the popup has no enabled ``accommodation-booking`` step, and
both filter to the subset of properties that step offers. That mirrors the
gate in ``payments.resolve_lines``: a restriction the checkout enforces only
by not rendering something is not a restriction, it is a suggestion.
"""

import uuid
from decimal import Decimal

from fastapi import HTTPException, status
from sqlmodel import Session

from app.api.accommodation import crud
from app.api.accommodation.availability import (
    REASON_SOLD_OUT,
    availability_by_accommodation,
    check_stay_allowed,
    effective_min_stay,
)
from app.api.accommodation.models import (
    AccommodationProperties,
    Accommodations,
)
from app.api.accommodation.payments import AccommodationStepOffer, step_offer
from app.api.accommodation.pricing import quote_accommodation
from app.api.accommodation.schemas import (
    AccommodationImagePublic,
    AccommodationOffer,
    BedSpec,
    PublicAccommodation,
    PublicAccommodationAvailability,
    PublicAccommodationProperty,
)

# The offer and the availability call must agree on which room types exist;
# both go through this so a property filtered out of one cannot be priced by
# the other.
MAX_STAY_NIGHTS = 365


def _not_offered() -> HTTPException:
    """404, not 403: a checkout that does not sell rooms has no rooms page.

    Telling an anonymous caller "this exists but is turned off" leaks the
    popup's configuration for nothing.
    """
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="This checkout does not offer accommodations",
    )


def _resolve_offer(
    session: Session, popup_id: uuid.UUID, sales_flow_id: uuid.UUID
) -> AccommodationStepOffer:
    offer = step_offer(session, popup_id, sales_flow_id)
    if not offer.enabled:
        raise _not_offered()
    return offer


def _parse_beds(raw: object) -> list[BedSpec]:
    """Read the JSONB bed list, dropping anything that no longer validates.

    A bed type removed from the enum must cost the buyer one line of the
    description, not the whole checkout page.
    """
    if not isinstance(raw, list):
        return []
    beds: list[BedSpec] = []
    for entry in raw:
        try:
            beds.append(BedSpec.model_validate(entry))
        except Exception:
            continue
    return beds


def _offered_accommodations(
    session: Session,
    popup_id: uuid.UUID,
    offer: AccommodationStepOffer,
) -> tuple[list[Accommodations], list[AccommodationProperties]]:
    """Room types the step sells, and the properties they belong to.

    Properties are derived from the room types rather than listed separately:
    a property with nothing bookable in it is a header with no content, and
    the buyer has no use for it.
    """
    accommodations = crud.accommodations_crud.find_by_popup(
        session,
        popup_id,
        property_ids=offer.property_ids or None,
        checkout_only=True,
    )
    if not accommodations:
        return [], []

    property_ids = {row.property_id for row in accommodations}
    properties = [
        row
        for row in crud.accommodation_properties_crud.find_by_popup(
            session, popup_id, active_only=True
        )
        if row.id in property_ids
    ]
    # Drop room types whose property is inactive: the operator turned the
    # building off, and the rooms inside it go with it.
    active_property_ids = {row.id for row in properties}
    accommodations = [
        row for row in accommodations if row.property_id in active_property_ids
    ]
    return accommodations, properties


def offer_for_popup(
    session: Session,
    popup_id: uuid.UUID,
    sales_flow_id: uuid.UUID,
    *,
    currency: str | None = None,
) -> AccommodationOffer:
    """Inventory for the accommodation step, before any dates are picked."""
    offer = _resolve_offer(session, popup_id, sales_flow_id)
    accommodations, properties = _offered_accommodations(session, popup_id, offer)

    popup_min_stay = crud.accommodations_crud.popup_min_stay(session, popup_id)
    images = crud.accommodations_crud.images_for_many(
        session, [row.id for row in accommodations]
    )

    return AccommodationOffer(
        currency=currency,
        properties=[
            PublicAccommodationProperty(
                id=row.id,
                name=row.name,
                address=row.address,
                description=row.description,
                tax_percentage=row.tax_percentage,
            )
            for row in properties
        ],
        accommodations=[
            PublicAccommodation(
                id=row.id,
                property_id=row.property_id,
                product_id=row.product_id,
                name=row.name,
                kind=row.kind,
                description=row.description,
                guest_capacity=row.guest_capacity,
                beds=_parse_beds(row.beds),
                default_nightly_price=Decimal(row.default_nightly_price),
                long_stay_price=(
                    Decimal(row.long_stay_price)
                    if row.long_stay_price is not None
                    else None
                ),
                min_stay=effective_min_stay(row, popup_min_stay),
                bookable_from=row.bookable_from,
                bookable_to=row.bookable_to,
                images=[
                    AccommodationImagePublic.model_validate(image)
                    for image in images.get(row.id, [])
                ],
            )
            for row in accommodations
        ],
    )


def availability_for_popup(
    session: Session,
    popup_id: uuid.UUID,
    sales_flow_id: uuid.UUID,
    *,
    check_in,
    check_out,
    guest_count: int | None = None,
    currency: str | None = None,
) -> list[PublicAccommodationAvailability]:
    """Free rooms and price per room type, for one date range.

    One call covers the whole screen: the checkout re-asks on every date
    change, and doing that per card would be an N+1 on the hot path.
    """
    offer = _resolve_offer(session, popup_id, sales_flow_id)

    if check_out <= check_in:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="check_out must be after check_in",
        )
    if (check_out - check_in).days > MAX_STAY_NIGHTS:
        # Not a business rule so much as a guard: the quote materialises one
        # row per night, and an anonymous caller should not be able to ask
        # for a decade of them.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That stay is too long to quote",
        )

    accommodations, properties = _offered_accommodations(session, popup_id, offer)
    if not accommodations:
        return []

    tax_by_property = {row.id: row.tax_percentage for row in properties}
    popup_min_stay = crud.accommodations_crud.popup_min_stay(session, popup_id)
    counts = availability_by_accommodation(
        session, [row.id for row in accommodations], check_in, check_out
    )
    rules = crud.accommodation_price_rules_crud.find_for_accommodations(
        session, [row.id for row in accommodations]
    )

    results: list[PublicAccommodationAvailability] = []
    for accommodation in accommodations:
        reason = check_stay_allowed(
            accommodation,
            check_in,
            check_out,
            popup_min_stay=popup_min_stay,
            guest_count=guest_count,
        )
        available = 0 if reason else counts.get(accommodation.id, 0)
        if not reason and available == 0:
            reason = REASON_SOLD_OUT

        # Price it even when it cannot be booked: the card still shows what
        # the stay would cost, and a sold-out room with no price reads as
        # broken rather than as taken.
        quote = quote_accommodation(
            accommodation,
            rules.get(accommodation.id, []),
            check_in,
            check_out,
            tax_percentage=tax_by_property.get(accommodation.property_id),
            currency=currency,
        )

        results.append(
            PublicAccommodationAvailability(
                accommodation_id=accommodation.id,
                available=available,
                unavailable_reason=reason,
                quote=quote,
            )
        )
    return results
