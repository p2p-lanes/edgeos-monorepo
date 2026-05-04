"""Router for the open-ticketing checkout API.

Endpoints:
- GET  /checkout/{slug}/bootstrap — public, anonymous, rate-limited 120/min/IP
- POST /checkout/{slug}/purchase  — public, anonymous, rate-limited 10/min/IP
"""

from fastapi import APIRouter, Depends

from app.api.checkout.crud import get_open_ticketing_popup, runtime_for_slug
from app.api.checkout.schemas import (
    CheckoutRuntimeResponse,
    OpenTicketingPurchaseCreate,
    OpenTicketingPurchaseResponse,
)
from app.api.payment.crud import payments_crud
from app.api.tenant.models import Tenants
from app.core.dependencies.users import SessionDep
from app.core.rate_limit import RateLimit

router = APIRouter(prefix="/checkout", tags=["checkout"])


@router.get(
    "/{slug}/runtime",
    response_model=CheckoutRuntimeResponse,
    dependencies=[
        Depends(
            RateLimit(limit=120, window_sec=60, key_prefix="rl:checkout-bootstrap")
        ),
    ],
)
async def get_runtime(
    slug: str,
    db: SessionDep,
) -> CheckoutRuntimeResponse:
    """Return popup metadata, products, buyer form, and ticketing steps for anonymous checkout.

    Fully public endpoint (no JWT). Only serves sale_type=direct active popups.
    Rate-limited 120/min/IP.
    """
    return runtime_for_slug(db, slug)


@router.post(
    "/{slug}/purchase",
    response_model=OpenTicketingPurchaseResponse,
    dependencies=[
        Depends(RateLimit(limit=10, window_sec=60, key_prefix="rl:checkout-purchase")),
    ],
)
async def purchase_open_ticketing(
    slug: str,
    request_in: OpenTicketingPurchaseCreate,
    db: SessionDep,
) -> OpenTicketingPurchaseResponse:
    """Create an anonymous open-ticketing payment and return provider checkout data."""
    popup = get_open_ticketing_popup(db, slug)
    tenant = db.get(Tenants, popup.tenant_id)
    if tenant is None:
        raise ValueError(f"Tenant not found for popup {popup.id}")

    payment, checkout_url = payments_crud.create_open_ticketing_payment(
        db,
        obj=request_in,
        popup=popup,
        tenant=tenant,
    )

    return OpenTicketingPurchaseResponse(
        payment_id=payment.id,
        status=payment.status,
        checkout_url=checkout_url,
        amount=payment.amount,
        currency=payment.currency,
    )
