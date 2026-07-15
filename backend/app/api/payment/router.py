import json
import re
import uuid
from decimal import Decimal
from ipaddress import ip_address
from typing import TYPE_CHECKING, Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlmodel import Session

from app.api.audit_log.actor import actor_from_human
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import (
    ApplicationFeeCreate,
    PaymentCreate,
    PaymentFilter,
    PaymentPreview,
    PaymentPublic,
    PaymentSource,
    PaymentStatus,
    PaymentStatusCheck,
    PaymentUpdate,
    PendingReleaseAuthRequest,
    PendingReleaseResponse,
    SimpleFIInstallmentPlan,
    SimpleFIInstallmentPlanPayload,
    SimpleFIPaymentInfo,
    SimpleFIPaymentRequest,
    SimpleFIWebhookPayload,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_PaymentsRead,
    AdminOrApiKeySession_PaymentsRead,
    CurrentHuman,
    CurrentOperatorJwtOnly,
    HumanTenantSession,
    SessionDep,
    TenantSession,
    needs,
)
from app.core.redis import WebhookCache
from app.services.email_helpers import send_application_status_email

# Email notification helpers live in app.services.payment_notifications to
# allow import by background jobs without creating a circular dependency with
# the web layer.  The names are re-exported here under their original private
# identifiers so existing call sites and test monkey-patches keep working.
from app.services.payment_notifications import (  # noqa: F401
    _build_payment_confirmed_context,
    _send_payment_confirmed_email,
)
from app.services.payment_notifications import (
    send_payment_confirmed_email_best_effort as _send_payment_confirmed_email_best_effort,
)

if TYPE_CHECKING:
    from app.api.human.models import Humans
    from app.api.popup.models import Popups

router = APIRouter(prefix="/payments", tags=["payments"])

_META_BROWSER_ID_PATTERN = re.compile(r"^fb\.1\.\d{10,13}\.[A-Za-z0-9._-]{1,256}$")
_MAX_USER_AGENT_LENGTH = 512


def _normalize_payment_source(provider: str | None) -> str:
    """Normalize provider labels from SimpleFI to local payment sources."""
    if not provider:
        return "SimpleFI"

    normalized = provider.strip().lower()
    if normalized == "stripe":
        return "Stripe"
    if normalized in {"mercadopago", "mercado pago", "mercado_pago"}:
        return "MercadoPago"
    return provider.strip()


def _first_non_empty(*values: str | None) -> str | None:
    for value in values:
        if value:
            stripped = value.strip()
            if stripped:
                return stripped
    return None


def _sanitize_meta_browser_id(value: str | None) -> str | None:
    candidate = _first_non_empty(value)
    if candidate is None or len(candidate) > 512:
        return None
    if not _META_BROWSER_ID_PATTERN.fullmatch(candidate):
        return None
    return candidate


def _sanitize_client_ip(value: str | None) -> str | None:
    candidate = _first_non_empty(value)
    if candidate is None or len(candidate) > 128:
        return None
    try:
        return str(ip_address(candidate))
    except ValueError:
        return None


def _extract_client_ip(request: Request) -> str | None:
    direct_ip = _sanitize_client_ip(request.client.host if request.client else None)
    if direct_ip:
        return direct_ip

    forwarded_for = request.headers.get("X-Forwarded-For")
    if not forwarded_for or len(forwarded_for) > 512:
        return None
    return _sanitize_client_ip(forwarded_for.split(",", maxsplit=1)[0])


def _extract_meta_attribution(
    request: Request,
    *,
    fbc: str | None = None,
    fbp: str | None = None,
) -> dict[str, str | None]:
    user_agent = _first_non_empty(request.headers.get("User-Agent"))
    return {
        "fbc": _sanitize_meta_browser_id(
            _first_non_empty(request.cookies.get("_fbc"), fbc)
        ),
        "fbp": _sanitize_meta_browser_id(
            _first_non_empty(request.cookies.get("_fbp"), fbp)
        ),
        "client_ip": _extract_client_ip(request),
        "client_user_agent": user_agent[:_MAX_USER_AGENT_LENGTH]
        if user_agent
        else None,
    }


def _webhook_payment_external_id(raw_body: dict[str, Any]) -> str | None:
    event_type = raw_body.get("event_type")
    data = raw_body.get("data") if isinstance(raw_body.get("data"), dict) else {}

    if event_type in {
        "installment_plan_activated",
        "installment_plan_cancelled",
        "installment_plan_completed",
    }:
        entity_id = raw_body.get("entity_id")
        return entity_id if isinstance(entity_id, str) else None

    payment_request = data.get("payment_request")
    if not isinstance(payment_request, dict):
        return None

    installment_plan_id = payment_request.get("installment_plan_id")
    if isinstance(installment_plan_id, str) and installment_plan_id:
        return installment_plan_id

    payment_request_id = payment_request.get("id")
    return payment_request_id if isinstance(payment_request_id, str) else None


def _verify_simplefi_webhook_or_raise(
    raw_body: dict[str, Any],
    db: Session,
) -> None:
    from loguru import logger

    external_id = _webhook_payment_external_id(raw_body)
    if external_id is None:
        logger.warning("SimpleFI webhook missing verifiable payment identifier")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook payload",
        )

    payment = payments_crud.get_by_external_id(db, external_id)
    if payment is None:
        logger.warning(
            "SimpleFI webhook rejected: payment not found for external_id={}",
            external_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )


def _extract_settlement_details(
    payload: SimpleFIWebhookPayload,
) -> tuple[str | None, Decimal | None, str]:
    """Extract settlement currency, rate, and visible source from a webhook."""
    payment_request = payload.data.payment_request
    settlement_currency = None
    settlement_rate = None

    if payload.data.new_payment is not None:
        settlement_currency = payload.data.new_payment.coin

    card_payment = payment_request.card_payment
    if card_payment is not None:
        settlement_currency = card_payment.coin or settlement_currency
        source = _normalize_payment_source(card_payment.provider)
    else:
        source = "SimpleFI"

    if settlement_currency:
        for transaction in payment_request.transactions:
            if transaction.coin == settlement_currency:
                settlement_rate = Decimal(str(transaction.price_details.rate))
                break

    return settlement_currency, settlement_rate, source


def _extract_charged_amount(payment_request: SimpleFIPaymentRequest) -> Decimal:
    """Total the buyer was actually charged, in the request's fiat currency.

    SimpleFi merchants can configure signed per-rail price adjustments, so this
    can differ from the quoted Payment.amount. Card payments carry the adjusted
    fiat total in card_payment.price_details.final_amount; the request's legacy
    `amount` scalar mirrors the crypto-rail adjusted total. `amount_paid` is NOT
    usable for card checkouts — SimpleFi normalizes the discount back out of it.
    """
    card_payment = payment_request.card_payment
    if card_payment is not None and card_payment.price_details is not None:
        return Decimal(str(card_payment.price_details.final_amount))
    return Decimal(str(payment_request.amount))


def _plan_payment_source(plan: SimpleFIInstallmentPlan) -> str | None:
    """Settlement provider for an installment plan, from the activation payload.

    Subscription-charged installments never carry a card_payment object on
    their settlement webhooks, so activation is the only point where the
    rail/provider is visible. SimpleFi locks the payment method after the
    first charge, so the value stays accurate for the plan's lifetime.
    Returns None when the payload doesn't identify the rail (leave source
    untouched rather than guessing).
    """
    method = (plan.payment_method or "").upper()
    if method == "CRYPTO":
        return PaymentSource.CRYPTO.value
    if method == "CARD":
        if plan.stripe_subscription_id:
            return PaymentSource.STRIPE.value
        if plan.mercadopago_preapproval_id:
            return PaymentSource.MERCADOPAGO.value
    return None


def _schedule_meta_capi_purchase(payment: Payments) -> None:
    from loguru import logger

    from app.services.meta_capi import fire_and_forget_purchase_event

    try:
        fire_and_forget_purchase_event(
            tenant=payment.tenant,
            payment=payment,
            popup=payment.popup,
        )
    except Exception:
        logger.exception(
            "Failed to queue Meta CAPI Purchase event payment_id={}", payment.id
        )


def _installment_charged_amount(payment_request: SimpleFIPaymentRequest) -> Decimal:
    """Charged amount for a single installment's payment request.

    Card checkout installments carry the adjusted total in card_payment.price_details;
    subscription installments (Stripe / Mercado Pago) and crypto installments report
    the actually-debited amount directly in `amount_paid`.
    """
    card_payment = payment_request.card_payment
    if card_payment is not None and card_payment.price_details is not None:
        return Decimal(str(card_payment.price_details.final_amount))
    return Decimal(str(payment_request.amount_paid))


def _get_portal_owned_payment_or_404(
    db: HumanTenantSession,
    payment_id: uuid.UUID,
    current_human: CurrentHuman,
) -> Payments:
    payment = payments_crud.get_portal_owned_payment(db, payment_id, current_human.id)
    if payment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )
    return payment


def _get_portal_payment_context_or_404(
    db: HumanTenantSession,
    payment_id: uuid.UUID,
    current_human: CurrentHuman,
) -> tuple[Payments, "Popups", "Humans | None"]:
    payment = _get_portal_owned_payment_or_404(db, payment_id, current_human)

    if payment.application is not None:
        popup = payment.application.popup
        human = payment.application.human
    else:
        popup = payment.popup
        human = next(
            (
                product_snapshot.attendee.human
                for product_snapshot in payment.products_snapshot
                if product_snapshot.attendee is not None
                and product_snapshot.attendee.human_id == current_human.id
                and product_snapshot.attendee.human is not None
            ),
            None,
        )

    return payment, popup, human


def _require_application_id(application_id: uuid.UUID | None) -> uuid.UUID:
    if application_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Application id is required",
        )
    return application_id


def _require_external_id(external_id: str | None) -> str:
    if external_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )
    return external_id


@router.get("", response_model=ListModel[PaymentPublic])
async def list_payments(
    db: AdminOrApiKeySession_PaymentsRead,
    _: AdminOrApiKey_PaymentsRead,
    popup_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    external_id: str | None = None,
    payment_status: PaymentStatus | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: Literal["asc", "desc"] = "desc",
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PaymentPublic]:
    """List payments with optional filters (BO only)."""
    if popup_id:
        payments, total = payments_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            status_filter=payment_status,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    else:
        filters = PaymentFilter(
            application_id=application_id,
            external_id=external_id,
            status=payment_status,
        )
        payments, total = payments_crud.find_by_filter(
            db,
            filters=filters,
            skip=skip,
            limit=limit,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    return ListModel[PaymentPublic](
        results=[PaymentPublic.model_validate(p) for p in payments],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{payment_id}", response_model=PaymentPublic)
async def get_payment(
    payment_id: uuid.UUID,
    db: AdminOrApiKeySession_PaymentsRead,
    _: AdminOrApiKey_PaymentsRead,
) -> PaymentPublic:
    """Get a single payment (BO only)."""
    payment = payments_crud.get(db, payment_id)

    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    return PaymentPublic.model_validate(payment)


@router.get("/{payment_id}/invoice")
async def get_payment_invoice(
    payment_id: uuid.UUID,
    db: AdminOrApiKeySession_PaymentsRead,
    _: AdminOrApiKey_PaymentsRead,
) -> Response:
    """Download invoice PDF for a payment (BO only).

    Only available if the popup has invoice details configured.
    """
    from app.core.invoice import generate_invoice_pdf

    payment = payments_crud.get(db, payment_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # Resolve popup + human. Direct-sale payments have no application.
    if payment.application_id is not None and payment.application is not None:
        popup = payment.application.popup
        human = payment.application.human
    else:
        popup = payment.popup
        human = None
        if payment.products_snapshot:
            attendee = payment.products_snapshot[0].attendee
            if attendee is not None:
                human = attendee.human

    if not (
        popup
        and popup.invoice_company_name
        and popup.invoice_company_address
        and popup.invoice_company_email
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not available for this event",
        )

    first_name = human.first_name if human else ""
    last_name = human.last_name if human else ""
    client_name = f"{first_name or ''} {last_name or ''}".strip() or "N/A"

    pdf_bytes = generate_invoice_pdf(
        payment=payment,
        client_name=client_name,
        invoice_company_name=popup.invoice_company_name,
        invoice_company_address=popup.invoice_company_address,
        invoice_company_email=popup.invoice_company_email,
        header_image_url=popup.image_url,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="invoice-{payment_id}.pdf"',
        },
    )


@router.patch("/{payment_id}", response_model=PaymentPublic)
async def update_payment(
    payment_id: uuid.UUID,
    payment_in: PaymentUpdate,
    db: TenantSession,
    _current_user: CurrentOperatorJwtOnly,
) -> PaymentPublic:
    """Update a payment (BO only)."""

    payment = payments_crud.get(db, payment_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # If status is being updated, use the special method
    old_status = payment.status
    if payment_in.status:
        # Manual backoffice approval of an application-fee payment: route through
        # the shared handler so the application transitions out of PENDING_FEE and
        # credit is granted — identical to the SimpleFi webhook path.
        if (
            payment_in.status == PaymentStatus.APPROVED
            and old_status != PaymentStatus.APPROVED.value
        ):
            from app.api.payment.schemas import PaymentType

            if payment.payment_type == PaymentType.APPLICATION_FEE.value:
                await _handle_fee_payment_approved(db, payment, source="manual")
                return PaymentPublic.model_validate(payment)

        payment = payments_crud.update_status(db, payment_id, payment_in.status)
    else:
        payment = payments_crud.update(db, payment, payment_in)

    # Send email if payment was just approved
    if (
        payment_in.status == PaymentStatus.APPROVED
        and old_status != PaymentStatus.APPROVED.value
    ):
        await _send_payment_confirmed_email(payment, db_session=db)

    return PaymentPublic.model_validate(payment)


@router.post(
    "/my/application-fee",
    response_model=PaymentPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Create application fee payment",
    dependencies=[needs("portal:applications:write")],
)
async def create_my_application_fee(
    fee_in: ApplicationFeeCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentPublic:
    """Create an application fee payment for current human's application (Portal).

    The application must be in PENDING_FEE status. Returns PaymentPublic with
    checkout URL to redirect the user to the payment provider.
    """
    from app.api.application.crud import applications_crud

    application = applications_crud.get(db, fee_in.application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    from app.api.popup.guards import ensure_popup_writable

    popup = application.popup
    ensure_popup_writable(popup)
    payment = payments_crud.create_fee_payment(db, application, popup)
    return PaymentPublic.model_validate(payment)


@router.post(
    "/my/pending/release",
    response_model=PendingReleaseResponse,
    dependencies=[needs("portal:applications:write")],
    responses={
        409: {
            "description": (
                "Payment conflict. detail.code='previous_payment_completed' means the prior "
                "PENDING payment was concurrently approved — includes a redirect_url "
                "pointing to the buyer's passes page."
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
async def release_my_pending_payment(
    request_in: PendingReleaseAuthRequest,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PendingReleaseResponse:
    """Opportunistically release a buyer's own prior PENDING payment on checkout return (authenticated).

    Called by the portal on checkout mount for authenticated buyers (portal flow and
    popup-mode direct sale) before coupon validation or stock display.
    This frees any coupon/stock/credit holds so the buyer can re-apply their own
    single-use coupon without a false-invalid error (the circularity fix).

    Proof: application_id ownership, verified against current_human.id.

    Response contract:
    - HTTP 200 {released: false}: no PENDING for this application, or flag disabled.
    - HTTP 200 {released: true}: PENDING payment cancelled, holds freed.
    - HTTP 404: application not found or not owned by current_human (enumeration-safe).
    - HTTP 409 previous_payment_completed: race lost — prior payment already approved.
    - HTTP 502 payment_cancel_failed: SimpleFi unreachable; creation-time backstop remains.
    """
    result = payments_crud.release_pending_authenticated(
        db,
        application_id=request_in.application_id,
        human_id=current_human.id,
    )
    return PendingReleaseResponse(released=result.released)


@router.get(
    "/my/popup/{popup_id}",
    response_model=ListModel[PaymentPublic],
    summary="List your payments for a popup",
    dependencies=[needs("portal:payments:read")],
)
async def list_my_payments_by_popup(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    skip: Annotated[int, Query(ge=0, description="Number of payments to skip")] = 0,
    limit: Annotated[
        int, Query(ge=1, le=100, description="Max payments to return (max 100)")
    ] = 50,
) -> ListModel[PaymentPublic]:
    """List all payments owned by the current Human for a specific popup (Portal).

    Ownership is resolved via dual-path predicate:
    - Application leg: payment.application.human_id == current_human.id
    - Direct-sale leg: payment_products.attendee.human_id == current_human.id

    Requires OTP-authenticated Human token. Empty result is valid (not 404).
    """
    payments, total = payments_crud.find_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id, skip=skip, limit=limit
    )
    results = [PaymentPublic.model_validate(p) for p in payments]
    return ListModel[PaymentPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get(
    "/my/latest",
    response_model=PaymentStatusCheck,
    dependencies=[needs("portal:payments:read")],
)
async def get_my_latest_payment(
    application_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentStatusCheck:
    """Get the latest payment status for an application owned by current human (Portal)."""
    from app.api.application.crud import applications_crud

    # Verify human owns this application
    application = applications_crud.get(db, application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    payment = payments_crud.get_latest_by_application(db, application_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No payments found for this application",
        )

    return PaymentStatusCheck(
        id=payment.id,
        status=PaymentStatus(payment.status),
    )


@router.get(
    "/my/{payment_id}/status",
    response_model=PaymentStatusCheck,
    dependencies=[needs("portal:payments:read")],
)
async def get_my_payment_status(
    payment_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentStatusCheck:
    """Get the current status for an owned payment (Portal)."""
    payment = _get_portal_owned_payment_or_404(db, payment_id, current_human)

    return PaymentStatusCheck(
        id=payment.id,
        status=PaymentStatus(payment.status),
    )


@router.get(
    "/my/{application_id}",
    response_model=ListModel[PaymentPublic],
    dependencies=[needs("portal:payments:read")],
)
async def list_my_payments(
    application_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PaymentPublic]:
    """List payments for an application owned by current human (Portal)."""
    from app.api.application.crud import applications_crud

    # Verify human owns this application
    application = applications_crud.get(db, application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    payments, total = payments_crud.find_by_application(
        db, application_id=application_id, skip=skip, limit=limit
    )

    return ListModel[PaymentPublic](
        results=[PaymentPublic.model_validate(p) for p in payments],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get(
    "/my/{payment_id}/invoice",
    dependencies=[needs("portal:payments:read")],
)
async def get_my_invoice(
    payment_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> Response:
    """Download invoice PDF for a payment owned by current human (Portal).

    Only available if the popup has invoice details configured.
    """
    from app.core.invoice import generate_invoice_pdf

    payment, popup, human = _get_portal_payment_context_or_404(
        db,
        payment_id,
        current_human,
    )

    # Only generate invoice if popup has all invoice fields configured
    if not (
        popup
        and popup.invoice_company_name
        and popup.invoice_company_address
        and popup.invoice_company_email
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not available for this event",
        )

    first_name = human.first_name if human else ""
    last_name = human.last_name if human else ""
    client_name = f"{first_name or ''} {last_name or ''}".strip() or "N/A"

    pdf_bytes = generate_invoice_pdf(
        payment=payment,
        client_name=client_name,
        invoice_company_name=popup.invoice_company_name,
        invoice_company_address=popup.invoice_company_address,
        invoice_company_email=popup.invoice_company_email,
        header_image_url=popup.image_url,
    )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="invoice-{payment_id}.pdf"',
        },
    )


@router.post(
    "/my/preview",
    response_model=PaymentPreview,
    dependencies=[needs("portal:payments:read")],
)
async def preview_my_payment(
    payment_in: PaymentCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentPreview:
    """
    Preview a payment calculation without creating it (Portal).

    Returns the calculated amount with any applicable discounts.
    """
    from app.api.application.crud import applications_crud

    # Verify human owns this application
    application = applications_crud.get(
        db,
        _require_application_id(payment_in.application_id),
    )
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    preview = payments_crud.preview_payment(db, payment_in)
    return preview


@router.post(
    "/my",
    response_model=PaymentPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[needs("portal:applications:write")],
    responses={
        409: {
            "description": (
                "Concurrent payment conflict. "
                "detail.code is one of: "
                "'concurrent_payment_in_progress' (another PENDING payment exists and could not be superseded) or "
                "'previous_payment_completed' (prior payment was completed — redirect_url points to the buyer's passes page)."
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
async def create_my_payment(
    payment_in: PaymentCreate,
    request: Request,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentPublic:
    """
    Create a payment for current human's application (Portal).

    If the total is zero or negative (covered by credit), the products
    are immediately assigned and the payment is auto-approved.

    Otherwise, returns PaymentPublic with checkout URL for external payment.
    """
    from app.api.application.crud import applications_crud

    # Verify human owns this application
    application = applications_crud.get(
        db,
        _require_application_id(payment_in.application_id),
    )
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(application.popup)

    payment, _preview = payments_crud.create_payment(
        db,
        payment_in,
        attribution=_extract_meta_attribution(request),
        actor=actor_from_human(current_human),
    )

    if payment.status == PaymentStatus.APPROVED.value:
        await _send_payment_confirmed_email_best_effort(payment, db_session=db)

    return PaymentPublic.model_validate(payment)


@router.post("/direct", include_in_schema=False)
async def create_direct_payment_gone() -> None:
    """Legacy direct payment tombstone.

    Without this explicit POST handler, `/payments/{payment_id}` keeps the path
    shape reserved and Starlette returns 405 for POST /payments/direct.
    We want a hard 404 contract for the removed legacy surface.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Not Found",
    )


@router.post("/webhook/simplefi", status_code=status.HTTP_200_OK)
async def simplefi_webhook(
    request: Request,
    db: SessionDep,
) -> dict:
    """
    Webhook endpoint for SimpleFI payment notifications.

    Routes by event_type to handle regular payments, installment payments,
    and installment plan lifecycle events.
    """
    from loguru import logger

    from app.core.redis import webhook_cache

    raw_payload = await request.body()
    try:
        raw_body = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook payload",
        ) from exc
    if not isinstance(raw_body, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid webhook payload",
        )

    _verify_simplefi_webhook_or_raise(raw_body, db)

    event_type = raw_body.get("event_type")
    logger.info(
        "SimpleFI webhook received: event_type={} entity_type={} entity_id={}",
        event_type,
        raw_body.get("entity_type"),
        raw_body.get("entity_id"),
    )

    if event_type == "installment_plan_completed":
        return await _handle_installment_plan_completed(raw_body, db, webhook_cache)

    if event_type == "installment_plan_activated":
        return await _handle_installment_plan_activated(raw_body, db, webhook_cache)

    if event_type == "installment_plan_cancelled":
        return await _handle_installment_plan_cancelled(raw_body, db, webhook_cache)

    if event_type == "payment_request_expired":
        payload = SimpleFIWebhookPayload(**raw_body)
        return await _handle_payment_request_expired(payload, db, webhook_cache)

    if event_type not in ("new_payment", "new_card_payment"):
        logger.info("Unhandled event type: {}. Ignoring.", event_type)
        return {"message": f"Event type {event_type} not handled"}

    # Parse the full payload for payment events
    payload = SimpleFIWebhookPayload(**raw_body)

    # Check if this is an installment payment
    if payload.data.payment_request.installment_plan_id:
        return await _handle_installment_payment(payload, db, webhook_cache)

    # Regular payment flow
    return await _handle_regular_payment(payload, db, webhook_cache)


async def _handle_regular_payment(
    payload: SimpleFIWebhookPayload,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle new_payment/new_card_payment for regular (non-installment) payments."""
    from loguru import logger

    payment_request_id = payload.data.payment_request.id
    event_type = payload.event_type

    fingerprint = f"simplefi:{payment_request_id}:{event_type}"
    if not webhook_cache.add(fingerprint):
        logger.info(
            "Webhook already processed (fingerprint: %s). Skipping...", fingerprint
        )
        return {"message": "Webhook already processed"}

    logger.info(
        "SimpleFI regular payment webhook processing: payment_request_id=%s event_type=%s provider_status=%s",
        payment_request_id,
        event_type,
        payload.data.payment_request.status,
    )

    payment = payments_crud.get_by_external_id(db, payment_request_id)
    if not payment:
        logger.warning("Payment not found for external_id: {}", payment_request_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    payment_request_status = payload.data.payment_request.status

    logger.info(
        "SimpleFI payment matched local payment: payment_id={} external_id={} current_status={} provider_status={} payment_type={}",
        payment.id,
        payment.external_id,
        payment.status,
        payment_request_status,
        payment.payment_type,
    )

    if payment.status == payment_request_status:
        logger.info(
            "Payment status unchanged (%s). Skipping...", payment_request_status
        )
        return {"message": "Payment status unchanged"}

    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

    if payment_request_status == "approved":
        from app.api.payment.schemas import PaymentType

        # Recorded before approval so it lands in the same commit.
        payment.amount_charged = _extract_charged_amount(payload.data.payment_request)

        if payment.payment_type == PaymentType.APPLICATION_FEE.value:
            await _handle_fee_payment_approved(
                db,
                payment,
                settlement_currency=settlement_currency,
                rate=settlement_rate,
                source=source,
            )
        else:
            payment = payments_crud.approve_payment(
                db,
                payment.id,
                settlement_currency=settlement_currency,
                rate=settlement_rate,
                source=source,
            )
            _schedule_meta_capi_purchase(payment)
            await _send_payment_confirmed_email_best_effort(payment, db_session=db)
        logger.info("Payment {} approved via SimpleFI webhook", payment.id)
    else:
        payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
        logger.info(
            "Payment %s marked as expired (status: %s)",
            payment.id,
            payment_request_status,
        )

    return {"message": "Payment status updated successfully"}


async def _handle_payment_request_expired(
    payload: SimpleFIWebhookPayload,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle SimpleFI payment request expiration webhooks."""
    from loguru import logger

    payment_request_id = payload.data.payment_request.id
    fingerprint = f"simplefi:{payment_request_id}:{payload.event_type}"
    if not webhook_cache.add(fingerprint):
        logger.info(
            "Webhook already processed (fingerprint: %s). Skipping...", fingerprint
        )
        return {"message": "Webhook already processed"}

    payment = payments_crud.get_by_external_id(db, payment_request_id)
    if not payment:
        logger.warning(
            "Payment not found for expired external_id: {}", payment_request_id
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    if payment.status == PaymentStatus.APPROVED.value:
        logger.warning(
            "Ignoring expiration webhook for already-approved payment {}",
            payment.id,
        )
        return {"message": "Payment already approved"}

    # Extend early-return to cover all already-finalized statuses.
    # EXPIRED: duplicate webhook delivery — stock already restored on first fire.
    # CANCELLED / REJECTED: admin already finalized the payment via update_status
    # (which ran _restore_payment_stock at that time) — no second restore needed.
    # LEAST-clamp in restore helpers is a structural backstop, but we also guard
    # semantically here so we don't double-count the same expiry event.
    if payment.status in (
        PaymentStatus.EXPIRED.value,
        PaymentStatus.CANCELLED.value,
        PaymentStatus.REJECTED.value,
    ):
        logger.info(
            "Payment {} already finalized (status={}). Skipping expiry webhook.",
            payment.id,
            payment.status,
        )
        return {"message": "Payment status unchanged"}

    logger.info(
        "SimpleFI expiration webhook matched local payment: payment_id={} external_id={} current_status={} provider_status={}",
        payment.id,
        payment.external_id,
        payment.status,
        payload.data.payment_request.status,
    )

    # Delegate to update_status which runs _restore_payment_stock (guarded by
    # old_status == PENDING) before marking the payment EXPIRED.
    # Source of truth for per-product quantities: payment.products_snapshot
    # (PaymentProducts rows). SimpleFI's payload only carries payment_request.id.
    payments_crud.update_status(db, payment.id, PaymentStatus.EXPIRED)
    logger.info(
        "Payment {} marked as expired via SimpleFI webhook (external_id: {})",
        payment.id,
        payment_request_id,
    )
    return {"message": "Payment marked as expired"}


async def _handle_fee_payment_approved(
    db: Session,
    payment: Payments,
    *,
    settlement_currency: str | None = None,
    rate: Decimal | None = None,
    source: str = "SimpleFI",
) -> None:
    """Handle approval of an application fee payment.

    Approves the payment record, then transitions the application from
    PENDING_FEE → IN_REVIEW and applies the popup approval strategy.
    Idempotent: no-op if application is no longer in PENDING_FEE.
    """
    from loguru import logger

    from app.api.application.crud import applications_crud
    from app.api.application.schemas import ApplicationStatus
    from app.api.payment.schemas import PaymentStatus

    status_before = ApplicationStatus.PENDING_FEE.value

    # Approve the payment record first
    payment.status = PaymentStatus.APPROVED.value
    if settlement_currency is not None:
        payment.settlement_currency = settlement_currency
    if rate is not None:
        payment.rate = rate
    payment.source = source
    db.add(payment)
    db.flush()

    # Load application
    application = applications_crud.get(
        db,
        _require_application_id(payment.application_id),
    )
    if not application:
        logger.warning("Fee payment {} has no associated application", payment.id)
        db.commit()
        return

    # Idempotent guard
    if application.status != ApplicationStatus.PENDING_FEE.value:
        logger.warning(
            "Fee payment {} approved but application {} is in status '{}' (expected pending_fee). Skipping.",
            payment.id,
            application.id,
            application.status,
        )
        db.commit()
        return

    # Transition to IN_REVIEW and apply approval strategy
    application.status = ApplicationStatus.IN_REVIEW.value
    db.add(application)
    db.flush()

    human = application.human
    if human:
        applications_crud._apply_approval_strategy(db, application, human)

    db.commit()
    db.refresh(application)

    if human:
        await send_application_status_email(
            application,
            human,
            db,
            status_before=status_before,
        )

    logger.info(
        "Fee payment {} approved — application {} transitioned from pending_fee",
        payment.id,
        application.id,
    )


async def _handle_installment_payment(
    payload: SimpleFIWebhookPayload,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle new_payment/new_card_payment for installment plans."""
    from datetime import UTC, datetime

    from loguru import logger

    from app.api.payment.models import PaymentInstallments

    payment_request = payload.data.payment_request
    installment_plan_id = payment_request.installment_plan_id
    new_payment = payload.data.new_payment
    payment_request_id = payment_request.id

    fingerprint = f"simplefi:installment:{installment_plan_id}:{payment_request_id}"
    if not webhook_cache.add(fingerprint):
        logger.info("Webhook already processed. Skipping...")
        return {"message": "Webhook already processed"}

    logger.info(
        "Installment payment: plan_id=%s, payment_request_id=%s",
        installment_plan_id,
        payment_request_id,
    )

    # Look up Payment by installment_plan_id (stored in external_id)
    payment = payments_crud.get_by_external_id(
        db,
        _require_external_id(installment_plan_id),
    )
    if not payment:
        logger.warning("Payment not found for installment plan {}", installment_plan_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # Defence-in-depth dedupe: the redis-backed fingerprint above stops the
    # common case (same webhook re-delivered), but it doesn't survive cache
    # eviction or a deploy that clears state. If we already inserted an
    # installment row for this payment_request_id, skip — don't double-count.
    existing = next(
        (
            i
            for i in payment.installments
            if i.external_payment_id == payment_request_id
        ),
        None,
    )
    if existing is not None:
        logger.info(
            "Installment payment_request_id={} already recorded as installment #{} for payment {}; skipping",
            payment_request_id,
            existing.installment_number,
            payment.id,
        )
        return {"message": "Installment payment already recorded"}

    # Extract payment details
    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

    # Subscription-charged installments carry no card_payment object, so the
    # extracted source falls back to the residual "SimpleFI". If activation
    # already recorded the plan's provider (Stripe/MercadoPago/Crypto), keep
    # it — never downgrade to the residual. Webhook ordering isn't guaranteed.
    if payment.source and payment.source != PaymentSource.SIMPLEFI.value:
        source = payment.source

    if isinstance(new_payment, SimpleFIPaymentInfo):
        amount = Decimal(str(new_payment.amount))
        currency = new_payment.coin
        paid_at = new_payment.paid_at
    else:
        amount = Decimal(str(payment_request.amount_paid))
        currency = new_payment.coin if new_payment else "USD"
        paid_at = datetime.now(UTC)

    # Create PaymentInstallments record
    installment_number = len(payment.installments) + 1
    installment = PaymentInstallments(
        tenant_id=payment.tenant_id,
        payment_id=payment.id,
        external_payment_id=payment_request_id,
        installment_number=installment_number,
        amount=amount,
        currency=currency,
        paid_at=paid_at,
    )
    db.add(installment)

    # Accumulate the fiat total actually charged across installments. Uses the
    # payment request's charged amount, not the raw installment row amount —
    # the row may be denominated in the paying coin rather than fiat.
    payment.amount_charged = (
        payment.amount_charged or Decimal("0")
    ) + _installment_charged_amount(payment_request)

    # First installment: approve payment to assign products
    is_first_installment = (payment.installments_paid or 0) == 0
    if is_first_installment and payment.status != "approved":
        payment = payments_crud.approve_payment(
            db,
            payment.id,
            settlement_currency=settlement_currency,
            rate=settlement_rate,
            source=source,
        )
        _schedule_meta_capi_purchase(payment)
        logger.info("First installment received - payment {} approved", payment.id)

    # Increment installments_paid
    payment.installments_paid = (payment.installments_paid or 0) + 1
    db.commit()

    logger.info(
        "Installment %s recorded for payment %s (paid: %s/%s)",
        installment_number,
        payment.id,
        payment.installments_paid,
        payment.installments_total,
    )

    return {"message": "Installment payment recorded"}


async def _handle_installment_plan_completed(
    raw_body: dict,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle the installment_plan_completed webhook event."""
    from loguru import logger

    payload = SimpleFIInstallmentPlanPayload(**raw_body)
    entity_id = payload.entity_id
    event_type = payload.event_type

    fingerprint = f"simplefi:installment:{entity_id}:{event_type}"
    if not webhook_cache.add(fingerprint):
        logger.info("Webhook already processed. Skipping...")
        return {"message": "Webhook already processed"}

    logger.info("Installment plan completed: {}", entity_id)

    payment = payments_crud.get_by_external_id(db, entity_id)
    if not payment:
        logger.warning("Payment not found for installment plan {}", entity_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    if not payment.is_installment_plan:
        logger.warning(
            "Payment %s is not marked as an installment plan but received "
            "installment_plan_completed webhook",
            payment.id,
        )

    installment_plan = payload.data.installment_plan

    # Idempotent: if already approved, sync installments_paid and send email
    if payment.status == "approved":
        logger.info(
            "Payment %s already approved, syncing installments_paid", payment.id
        )
        payment.installments_paid = installment_plan.paid_installments_count
        db.commit()
        await _send_payment_confirmed_email_best_effort(payment, db_session=db)
        return {"message": "Installment plan completed - count synced"}

    # Edge case: plan completed but payment not approved
    logger.warning(
        "Payment %s not approved when installment_plan_completed received", payment.id
    )
    payment.installments_paid = installment_plan.paid_installments_count
    payment = payments_crud.approve_payment(db, payment.id)
    _schedule_meta_capi_purchase(payment)
    await _send_payment_confirmed_email_best_effort(payment, db_session=db)

    return {"message": "Installment plan payment approved successfully"}


async def _handle_installment_plan_activated(
    raw_body: dict,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle the installment_plan_activated webhook event."""
    from loguru import logger

    payload = SimpleFIInstallmentPlanPayload(**raw_body)
    entity_id = payload.entity_id
    event_type = payload.event_type

    fingerprint = f"simplefi:installment:{entity_id}:{event_type}"
    if not webhook_cache.add(fingerprint):
        logger.info("Webhook already processed. Skipping...")
        return {"message": "Webhook already processed"}

    logger.info("Installment plan activated: {}", entity_id)

    payment = payments_crud.get_by_external_id(db, entity_id)
    if not payment:
        logger.warning("Payment not found for installment plan {}", entity_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    installment_plan = payload.data.installment_plan
    new_total = installment_plan.number_of_installments
    new_paid = installment_plan.paid_installments_count
    plan_source = _plan_payment_source(installment_plan)

    # Idempotent. The fingerprint above catches the redis-cached case, but if
    # SimpleFi re-delivers after a cache eviction we should still no-op
    # cleanly. A *changed* number_of_installments would mean the buyer somehow
    # re-picked after activation — surface that as a warning rather than
    # silently overwriting, since downstream installment-counting depends on it.
    if payment.installments_total is not None:
        if payment.installments_total == new_total:
            changed = False
            if getattr(payment, "installments_paid", new_paid) != new_paid:
                payment.installments_paid = new_paid
                changed = True
            if (
                plan_source is not None
                and getattr(payment, "source", None) != plan_source
            ):
                payment.source = plan_source
                changed = True
            if changed:
                db.commit()
                return {"message": "Installment plan activation synced"}
            logger.info(
                "Payment {}: installments_total already set to {}; skipping",
                payment.id,
                new_total,
            )
            return {"message": "Installment plan already activated"}
        logger.warning(
            "Payment {}: installments_total changing {} -> {} on re-activation",
            payment.id,
            payment.installments_total,
            new_total,
        )

    payment.installments_total = new_total
    payment.installments_paid = new_paid

    # SimpleFi creates a "plan" even when the buyer picks pay-in-full
    # (number_of_installments = 1). Normalize the flag so data consumers
    # don't need a single-installment special case.
    if new_total == 1 and payment.is_installment_plan:
        payment.is_installment_plan = False
        logger.info(
            "Payment {}: single-installment plan — is_installment_plan normalized to False",
            payment.id,
        )

    # Activation is the only webhook that exposes the plan's rail/provider,
    # so record it here. Settlement must not downgrade it later (see
    # _handle_installment_payment).
    if plan_source is not None:
        payment.source = plan_source

    db.commit()

    logger.info(
        "Payment %s: installments_total updated to %s",
        payment.id,
        installment_plan.number_of_installments,
    )

    return {"message": "Installment plan activated successfully"}


async def _handle_installment_plan_cancelled(
    raw_body: dict,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle the installment_plan_cancelled webhook event."""
    from loguru import logger

    payload = SimpleFIInstallmentPlanPayload(**raw_body)
    entity_id = payload.entity_id
    event_type = payload.event_type

    fingerprint = f"simplefi:installment:{entity_id}:{event_type}"
    if not webhook_cache.add(fingerprint):
        logger.info("Webhook already processed. Skipping...")
        return {"message": "Webhook already processed"}

    logger.info("Installment plan cancelled: {}", entity_id)

    payment = payments_crud.get_by_external_id(db, entity_id)
    if not payment:
        logger.warning("Payment not found for installment plan {}", entity_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    old_status = payment.status

    # Idempotent: skip if already cancelled. The early return also keeps us
    # from double-restoring stock (the LEAST clamp is a backstop, not the
    # primary defence).
    if old_status == "cancelled":
        logger.info("Payment {} already cancelled. Skipping...", payment.id)
        return {"message": "Payment already cancelled"}

    # If the first installment had already approved the payment, attendee
    # products were assigned — revoke them before flipping status.
    if old_status == "approved":
        logger.info("Revoking products for cancelled payment {}", payment.id)
        payments_crud._remove_products_from_attendees(db, payment)

    # Restore stock for any in-progress plan (PENDING or APPROVED-partial).
    # The buyer abandoned mid-plan; we free inventory so other buyers can take
    # those tickets. This intentionally diverges from the documented
    # ``_restore_payment_stock`` contract (which limits APPROVED restores) —
    # installment plans never represent a fully-paid purchase when cancelled
    # by SimpleFi, so the refund-flow caveat doesn't apply. Duplicate webhook
    # delivery is already short-circuited by the already-cancelled check
    # above; the per-product LEAST clamp is the structural safety net.
    payments_crud._restore_payment_stock(db, payment)

    payment.status = "cancelled"
    db.commit()

    logger.info("Payment {} cancelled (stock restored)", payment.id)
    return {"message": "Installment plan cancelled successfully"}
