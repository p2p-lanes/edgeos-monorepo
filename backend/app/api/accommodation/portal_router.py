"""The same two reads, for the logged-in portal.

Accommodation is sold through an ordinary ticketing step, and that step
renders in both checkout flows: the anonymous one for ``sale_type=direct``
popups (``/checkout/{slug}/accommodations``) and the authenticated one for
application popups, which is this module.

The split exists because the two flows disagree about who the caller is, not
about what the data means, so both go through the same
``offer_for_popup`` / ``availability_for_popup``. Mirrors how products already
work: public ``/checkout/{slug}/runtime`` on one side, ``/portal/products``
behind ``CurrentHuman`` on the other. Serving an application popup's inventory
anonymously would expose what today requires an account, so it is not done.
"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.accommodation.public import (
    availability_for_popup,
    offer_for_popup,
)
from app.api.accommodation.schemas import (
    AccommodationAvailabilityRequest,
    AccommodationOffer,
    PublicAccommodationAvailability,
)
from app.api.popup.models import Popups
from app.core.dependencies.users import CurrentHuman, HumanTenantSession

portal_router = APIRouter(prefix="/portal/accommodations", tags=["accommodations"])


def _get_popup(db, popup_id: uuid.UUID) -> Popups:
    """Resolve the popup, or 404.

    The session is tenant-scoped, so a popup belonging to another tenant is
    invisible here and comes back as a plain not-found rather than as a
    forbidden. Same answer either way, and it leaks nothing.
    """
    popup = db.get(Popups, popup_id)
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )
    return popup


def _get_flow(db, popup: Popups, sales_flow_id: uuid.UUID, current_human):
    """Resolve an accessible sales flow that belongs to ``popup``."""
    from app.api.sales_flow.crud import sales_flows_crud
    from app.api.sales_flow.eligibility import (
        assert_application_flow_eligible,
        assert_upsale_eligible,
    )
    from app.api.sales_flow.resolver import resolve_flow

    requested = sales_flows_crud.get(db, sales_flow_id)
    if requested is None or requested.popup_id != popup.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found for this popup",
        )
    flow = resolve_flow(db, popup, requested.slug)
    assert_upsale_eligible(db, flow, popup.id, popup.tenant_id, current_human)
    assert_application_flow_eligible(db, flow, popup.tenant_id, current_human)
    return flow


@portal_router.get("", response_model=AccommodationOffer)
async def list_portal_accommodations(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    popup_id: uuid.UUID,
    sales_flow_id: uuid.UUID,
) -> AccommodationOffer:
    """Room types this popup's checkout sells, before any dates are picked.

    404 when the popup has no enabled ``accommodation-booking`` step, exactly
    as the anonymous endpoint answers: being logged in says who you are, not
    that a checkout sells rooms it does not sell.
    """
    popup = _get_popup(db, popup_id)
    flow = _get_flow(db, popup, sales_flow_id, current_human)
    return offer_for_popup(db, popup.id, flow.id, currency=popup.currency)


@portal_router.post(
    "/availability", response_model=list[PublicAccommodationAvailability]
)
async def check_portal_accommodation_availability(
    request_in: AccommodationAvailabilityRequest,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    popup_id: uuid.UUID,
    sales_flow_id: uuid.UUID,
) -> list[PublicAccommodationAvailability]:
    """Free rooms and the price of the stay, for every room type at once.

    Read-only: nothing is held. The room is taken off the market by the
    payment (``POST /payments`` on this flow), not by looking at it.
    """
    popup = _get_popup(db, popup_id)
    flow = _get_flow(db, popup, sales_flow_id, current_human)
    return availability_for_popup(
        db,
        popup.id,
        flow.id,
        check_in=request_in.check_in,
        check_out=request_in.check_out,
        guest_count=request_in.guest_count,
        currency=popup.currency,
    )
