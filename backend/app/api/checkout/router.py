"""Router for the open-ticketing checkout API.

Endpoints:
- GET  /checkout/{slug}/runtime                       — public, rate-limited 120/min/IP
- POST /checkout/{slug}/purchase                      — public, rate-limited 10/min/IP
- POST /checkout/{slug}/email-verification/start      — public, rate-limited 5/min/IP
- POST /checkout/{slug}/email-verification/confirm    — public, rate-limited 20/min/IP
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.api.checkout.crud import get_open_ticketing_popup, runtime_for_slug
from app.api.checkout.email_verification import (
    confirm_code,
    is_email_verified,
    issue_code,
)
from app.api.checkout.schemas import (
    CheckoutRuntimeResponse,
    OpenTicketingPurchaseCreate,
    OpenTicketingPurchaseResponse,
)
from app.api.payment.crud import payments_crud
from app.core.dependencies.tenants import PublicTenant
from app.core.dependencies.users import SessionDep
from app.core.rate_limit import RateLimit
from app.services.email import get_email_service

router = APIRouter(prefix="/checkout", tags=["checkout"])


class EmailVerificationStartRequest(BaseModel):
    email: EmailStr


class EmailVerificationConfirmRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=10)


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
    db: SessionDep,
    tenant: PublicTenant,
) -> OpenTicketingPurchaseResponse:
    """Create an anonymous open-ticketing payment and return provider checkout data."""
    popup = get_open_ticketing_popup(db, slug, tenant.id)

    # Gate the purchase on a valid email-verification marker for this
    # popup+email pair. The marker lives in Redis (30 min TTL) and is
    # set only after `/email-verification/confirm` returned True.
    if not is_email_verified(slug, request_in.buyer.email):
        raise HTTPException(
            status_code=403,
            detail="Email not verified for this popup. Request a code first.",
        )

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


@router.post(
    "/{slug}/email-verification/start",
    dependencies=[
        Depends(
            RateLimit(
                limit=5,
                window_sec=60,
                key_prefix="rl:checkout-emailverify-start",
            )
        ),
    ],
)
async def start_email_verification(
    slug: str,
    request_in: EmailVerificationStartRequest,
    db: SessionDep,
    tenant: PublicTenant,
) -> dict[str, bool]:
    """Issue a verification code to ``request_in.email`` for this popup.

    Returns ``{"sent": True}`` regardless of whether the email was
    previously issued — the code is overwritten so legitimate retries
    work without leaking which addresses already received a code.
    """
    popup = get_open_ticketing_popup(db, slug, tenant.id)
    try:
        code = issue_code(slug, request_in.email)
    except RuntimeError as exc:
        # Redis unreachable — surface a 503 so the portal can fall back
        # to "skip verification" if its UX allows it.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Send the code. We piggyback on the existing login-code template
    # (subject + 6-digit code is the same shape). Run synchronously inside
    # the request — the email service is already async.
    email_service = get_email_service()
    subject = f"{popup.name}: tu código de verificación"
    body_html = (
        f"<p>Hola,</p>"
        f"<p>Tu código de verificación para <strong>{popup.name}</strong> "
        f"es:</p>"
        f"<p style='font-size:1.5rem;letter-spacing:0.2em;"
        f"font-weight:700'>{code}</p>"
        f"<p>El código expira en 10 minutos.</p>"
    )
    body_text = (
        f"Tu código de verificación para {popup.name}: {code} "
        f"(expira en 10 minutos)."
    )
    await email_service.send_email(
        to=request_in.email,
        subject=subject,
        html_content=body_html,
        text_content=body_text,
        from_address=getattr(tenant, "sender_email", None),
        from_name=getattr(tenant, "sender_name", None),
    )
    return {"sent": True}


@router.post(
    "/{slug}/email-verification/confirm",
    dependencies=[
        Depends(
            RateLimit(
                limit=20,
                window_sec=60,
                key_prefix="rl:checkout-emailverify-confirm",
            )
        ),
    ],
)
async def confirm_email_verification(
    slug: str,
    request_in: EmailVerificationConfirmRequest,
    db: SessionDep,
    tenant: PublicTenant,
) -> dict[str, bool]:
    """Validate a code previously issued via /start. Returns verified=True/False."""
    # Touch the popup lookup so invalid slugs 404 fast (consistent with
    # the rest of this router).
    get_open_ticketing_popup(db, slug, tenant.id)
    # Code format check — strict 6-digit numeric is the format we issue;
    # accept a touch wider for forward-compat but normalise here.
    code = re.sub(r"\s+", "", request_in.code)
    return {"verified": confirm_code(slug, request_in.email, code)}
