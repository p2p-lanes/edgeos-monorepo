"""Router for the open-ticketing checkout API.

Endpoints:
- GET  /checkout/{slug}/runtime  — public, anonymous, rate-limited 120/min/IP
- GET  /checkout/{slug}/share    — public, anonymous, rate-limited 120/min/IP
- POST /checkout/{slug}/purchase — public, anonymous, rate-limited 10/min/IP
"""

import uuid
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Header,
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
    PendingReleaseOpenRequest,
)
from app.api.human.crud import humans_crud
from app.api.payment.crud import payments_crud
from app.api.payment.router import (
    _extract_meta_attribution,
    _send_payment_confirmed_email,
)
from app.api.payment.schemas import PaymentStatus, PendingReleaseResponse
from app.api.translation.service import parse_accept_language
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
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> CheckoutRuntimeResponse:
    """Return popup metadata, products, buyer form, and ticketing steps for anonymous checkout.

    Fully public endpoint (no JWT). Only serves sale_type=direct active popups.
    Rate-limited 120/min/IP.
    """
    return runtime_for_slug(db, slug, tenant.id, parse_accept_language(accept_language))


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
                "Payment conflict. detail.code is one of: "
                "'pending_payment_exists' (a prior PENDING payment exists and no valid cart continuity proof was supplied — no cancellation attempted); "
                "'concurrent_payment_in_progress' (another checkout is in progress under the same email right now); "
                "'previous_payment_completed' (prior payment was already approved — includes redirect_url when a signing secret and external success URL are both configured)."
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
    """Save (create or replace) the open-checkout cart for an email.

    Fully public (no JWT). The email is resolved to a human so the cart is keyed
    by (human, popup) — the same key as the authenticated portal cart — and a
    buyer never ends up with two carts for the same popup. Returns a signed
    `restore_token` when the popup configures an open_checkout_signing_secret so
    the client can later rebuild the cart cross-device. Rate-limited 30/min/IP.
    """
    popup = get_open_ticketing_popup(db, slug, tenant.id)
    # Normalize before resolving the human: SQLModel skips the HumanBase email
    # validator on table inserts, so find_or_create is case-sensitive and a
    # differently-cased email would otherwise spawn a second human and cart.
    email = cart_in.email.lower()
    human = humans_crud.find_or_create(db, email=email, tenant_id=tenant.id)
    cart = carts_crud.upsert_open_cart(
        db,
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        email=email,
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

    cart = carts_crud.find_by_id_popup(db, cid, popup.id)
    if cart is None:
        raise HTTPException(status_code=404, detail="Cart not found")
    return _to_open_cart_public(cart, restore_token=sig)


@router.post(
    "/{slug}/pending/release",
    response_model=PendingReleaseResponse,
    dependencies=[
        Depends(
            RateLimit(limit=30, window_sec=60, key_prefix="rl:checkout-pending-release")
        ),
    ],
    responses={
        409: {
            "description": (
                "Payment conflict. detail.code='previous_payment_completed' means the prior "
                "PENDING payment was concurrently approved — includes a signed redirect_url "
                "when the popup has a signing secret and an external success URL configured."
            ),
        },
        502: {
            "description": (
                "Payment provider error. detail.code='payment_cancel_failed' means the prior "
                "pending payment could not be cancelled. Checkout should proceed — "
                "creation-time supersede remains as a backstop."
            ),
        },
    },
)
async def release_pending_open(
    slug: str,
    request_in: PendingReleaseOpenRequest,
    db: SessionDep,
    tenant: PublicTenant,
) -> PendingReleaseResponse:
    """Opportunistically release a buyer's own prior PENDING payment on checkout return.

    Called by the portal on checkout mount before coupon validation or stock display.
    This frees any coupon/stock/credit holds so the buyer can re-apply their own
    single-use coupon without a false-invalid error (the circularity fix).

    Proof: cart continuity HMAC (cid + sig), validated server-side.

    Response contract (ADR-R3 enumeration-safe):
    - HTTP 200 {released: false}: invalid/missing proof, no PENDING, or flag disabled.
      Body is byte-identical across ALL false outcomes to prevent email enumeration.
    - HTTP 200 {released: true}: PENDING payment cancelled, holds freed.
    - HTTP 409 previous_payment_completed: race lost — prior payment already approved.
    - HTTP 502 payment_cancel_failed: SimpleFi unreachable; creation-time backstop remains.

    Rate-limited 30/min/IP (matching the neighboring cart endpoint).
    """
    popup = get_open_ticketing_popup(db, slug, tenant.id)
    result = payments_crud.release_pending_open(
        db,
        popup=popup,
        email=str(request_in.email),
        cid=request_in.cid,
        sig=request_in.sig,
    )
    return PendingReleaseResponse(released=result.released)
