"""Router for the open-ticketing checkout API.

Endpoints:
- GET  /checkout/{slug}/runtime  — public, anonymous, rate-limited 120/min/IP
- GET  /checkout/{slug}/share    — public, anonymous, rate-limited 120/min/IP
- POST /checkout/{slug}/purchase — public, anonymous, rate-limited 10/min/IP
"""

import uuid

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from loguru import logger

from app.api.cart.crud import carts_crud
from app.api.cart.schemas import CartState, OpenCartPublic, OpenCartUpsert
from app.api.checkout.crud import (
    get_open_ticketing_popup,
    runtime_for_slug,
    share_meta_for_slug,
)
from app.api.checkout.schemas import (
    CheckoutRuntimeResponse,
    CheckoutShareMeta,
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
from app.utils.checkout_signing import (
    build_cart_restore_token,
    verify_cart_restore_token,
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


@router.get(
    "/{slug}/share",
    response_model=CheckoutShareMeta,
    dependencies=[
        Depends(
            RateLimit(limit=120, window_sec=60, key_prefix="rl:checkout-public-share")
        ),
    ],
)
async def get_checkout_share_meta(
    slug: str,
    db: SessionDep,
    tenant: PublicTenant,
) -> CheckoutShareMeta:
    """Unauthenticated checkout metadata for social/OpenGraph share previews.

    Social crawlers send no JWT, so this route is intentionally public. It
    exposes only the popup name, tagline, location and cover image — never
    products, buyer forms or ticketing steps.

    Only active ``sale_type=direct`` popups for the resolved tenant are
    returned; everything else gets an opaque 404.
    """
    try:
        return share_meta_for_slug(db, slug, tenant.id)
    except HTTPException as exc:
        if exc.status_code in {
            status.HTTP_403_FORBIDDEN,
            status.HTTP_404_NOT_FOUND,
        }:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            ) from exc
        raise


@router.post(
    "/{slug}/purchase",
    response_model=OpenTicketingPurchaseResponse,
    dependencies=[
        Depends(RateLimit(limit=10, window_sec=60, key_prefix="rl:checkout-purchase")),
    ],
    responses={
        409: {
            "description": (
                "Concurrent payment conflict. "
                "detail.code is one of: "
                "'concurrent_payment_in_progress' (another PENDING payment exists and could not be superseded) or "
                "'previous_payment_completed' (prior payment was approved — includes redirect_url when signing is configured)."
            ),
        },
        502: {
            "description": (
                "Payment provider error. "
                "detail.code='payment_cancel_failed' means the prior pending payment could not be cancelled. "
                "Retry the request."
            ),
        },
    },
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

    payment, checkout_url, redirect_url = payments_crud.create_open_ticketing_payment(
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

    if checkout_url and payment.status == PaymentStatus.PENDING.value:
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

    # redirect_url is set by the CRUD only for the zero-amount bypass when the
    # popup configures a custom open-checkout success URL (signed when a secret
    # is set). Paid flows redirect via SimpleFi and return None here.
    return OpenTicketingPurchaseResponse(
        payment_id=payment.id,
        status=payment.status,
        checkout_url=checkout_url,
        redirect_url=redirect_url,
        amount=payment.amount,
        currency=payment.currency,
    )


def _to_open_cart_public(cart: object, *, restore_token: str | None) -> OpenCartPublic:
    """Build the anonymous cart response, coercing stored JSONB into CartState."""
    raw_items = getattr(cart, "items", None) or {}
    return OpenCartPublic(
        id=cart.id,  # type: ignore[attr-defined]
        popup_id=cart.popup_id,  # type: ignore[attr-defined]
        email=cart.email or "",  # type: ignore[attr-defined]
        items=CartState(**raw_items),
        restore_token=restore_token,
        created_at=getattr(cart, "created_at", None),
        updated_at=getattr(cart, "updated_at", None),
    )


@router.put(
    "/{slug}/cart",
    response_model=OpenCartPublic,
    dependencies=[
        Depends(RateLimit(limit=30, window_sec=60, key_prefix="rl:checkout-cart")),
    ],
)
async def upsert_open_cart(
    slug: str,
    cart_in: OpenCartUpsert,
    db: SessionDep,
    tenant: PublicTenant,
) -> OpenCartPublic:
    """Save (create or replace) the anonymous open-checkout cart for an email.

    Fully public (no JWT), keyed by (popup, email). Returns a signed
    `restore_token` when the popup configures an open_checkout_signing_secret so
    the client can later rebuild the cart cross-device. Rate-limited 30/min/IP.
    """
    popup = get_open_ticketing_popup(db, slug, tenant.id)
    cart = carts_crud.upsert_anonymous(
        db,
        tenant_id=tenant.id,
        popup_id=popup.id,
        email=cart_in.email,
        items=cart_in.items,
    )
    secret = popup.open_checkout_signing_secret
    restore_token = build_cart_restore_token(str(cart.id), secret) if secret else None
    return _to_open_cart_public(cart, restore_token=restore_token)


@router.get(
    "/{slug}/cart",
    response_model=OpenCartPublic,
    dependencies=[
        Depends(
            RateLimit(limit=60, window_sec=60, key_prefix="rl:checkout-cart-restore")
        ),
    ],
)
async def restore_open_cart(
    slug: str,
    db: SessionDep,
    tenant: PublicTenant,
    cid: uuid.UUID = Query(..., description="Cart id from the signed restore link"),
    sig: str = Query(..., description="HMAC restore token for the cart id"),
) -> OpenCartPublic:
    """Restore an anonymous cart from a signed link (cid + sig).

    The cart is served only when the signature matches, so it can never be read
    by enumerating ids or emails. Requires the popup to have an
    open_checkout_signing_secret. Rate-limited 60/min/IP.
    """
    popup = get_open_ticketing_popup(db, slug, tenant.id)
    secret = popup.open_checkout_signing_secret
    if not secret:
        raise HTTPException(status_code=404, detail="Cart restore is not available")
    if not verify_cart_restore_token(str(cid), sig, secret):
        raise HTTPException(status_code=403, detail="Invalid cart link")

    cart = carts_crud.find_anonymous_by_id_popup(db, cid, popup.id)
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart not found")
    return _to_open_cart_public(cart, restore_token=sig)
