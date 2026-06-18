"""Router for the open-ticketing checkout API.

Endpoints:
- GET  /checkout/{slug}/runtime  — public, anonymous, rate-limited 120/min/IP
- POST /checkout/{slug}/purchase — public, anonymous, rate-limited 10/min/IP
"""

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from loguru import logger

from app.api.checkout.crud import get_open_ticketing_popup, runtime_for_slug
from app.api.checkout.schemas import (
    CheckoutRuntimeResponse,
    OpenTicketingPurchaseCreate,
    OpenTicketingPurchaseResponse,
)
from app.api.payment.crud import payments_crud
from app.api.payment.router import (
    _extract_meta_attribution,
    _send_payment_confirmed_email,
)
from app.api.payment.schemas import PaymentStatus
from app.core.dependencies.tenants import PublicTenant
from app.core.dependencies.users import SessionDep
from app.core.rate_limit import RateLimit
from app.services.meta_capi import (
    enqueue_initiate_checkout_event,
    enqueue_purchase_event,
)

router = APIRouter(prefix="/checkout", tags=["checkout"])


def _enqueue_checkout_initiate_checkout_event(
    background_tasks: BackgroundTasks,
    *,
    tenant: object,
    payment: object,
    popup: object,
) -> None:
    try:
        enqueue_initiate_checkout_event(
            background_tasks,
            tenant=tenant,
            payment=payment,
            popup=popup,
        )
    except Exception:
        logger.exception(
            "Failed to queue Meta CAPI InitiateCheckout event payment_id={}",
            getattr(payment, "id", ""),
        )


def _enqueue_checkout_purchase_event(
    background_tasks: BackgroundTasks,
    *,
    tenant: object,
    payment: object,
    popup: object,
) -> None:
    try:
        enqueue_purchase_event(
            background_tasks,
            tenant=tenant,
            payment=payment,
            popup=popup,
        )
    except Exception:
        logger.exception(
            "Failed to queue Meta CAPI Purchase event payment_id={}",
            getattr(payment, "id", ""),
        )


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
    tenant: PublicTenant,
) -> CheckoutRuntimeResponse:
    """Return popup metadata, products, buyer form, and ticketing steps for anonymous checkout.

    Fully public endpoint (no JWT). Only serves sale_type=direct active popups.
    Rate-limited 120/min/IP.
    """
    return runtime_for_slug(db, slug, tenant.id)


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
    request: Request,
    background_tasks: BackgroundTasks,
    db: SessionDep,
    tenant: PublicTenant,
) -> OpenTicketingPurchaseResponse:
    """Create an anonymous open-ticketing payment and return provider checkout data."""
    popup = get_open_ticketing_popup(db, slug, tenant.id)

    payment, checkout_url = payments_crud.create_open_ticketing_payment(
        db,
        obj=request_in,
        popup=popup,
        tenant=tenant,
        attribution=_extract_meta_attribution(
            request,
            fbc=request_in.fbc,
            fbp=request_in.fbp,
        ),
    )

    if checkout_url:
        _enqueue_checkout_initiate_checkout_event(
            background_tasks,
            tenant=tenant,
            payment=payment,
            popup=popup,
        )

    if payment.status == PaymentStatus.APPROVED.value:
        _enqueue_checkout_purchase_event(
            background_tasks,
            tenant=tenant,
            payment=payment,
            popup=popup,
        )
        try:
            await _send_payment_confirmed_email(payment, db_session=db)
        except Exception:
            logger.exception(
                "Failed to send open-ticketing payment confirmation email payment_id={}",
                payment.id,
            )

    return OpenTicketingPurchaseResponse(
        payment_id=payment.id,
        status=payment.status,
        checkout_url=checkout_url,
        amount=payment.amount,
        currency=payment.currency,
    )
