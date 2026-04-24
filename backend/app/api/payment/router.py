import uuid
from decimal import Decimal
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import (
    ApplicationFeeCreate,
    DirectPurchaseCreate,
    PaymentCreate,
    PaymentFilter,
    PaymentPreview,
    PaymentPublic,
    PaymentStatus,
    PaymentStatusCheck,
    PaymentUpdate,
    SimpleFIInstallmentPlanPayload,
    SimpleFIPaymentInfo,
    SimpleFIWebhookPayload,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)
from app.core.redis import WebhookCache
from app.services.email import (
    EmailAttachment,
    PaymentAttendeeItem,
    PaymentConfirmedContext,
    PaymentProductItem,
    compute_order_summary,
    get_email_service,
)
from app.services.email_helpers import send_application_status_email

if TYPE_CHECKING:
    from app.api.human.models import Humans
    from app.api.popup.models import Popups

router = APIRouter(prefix="/payments", tags=["payments"])


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


def _build_payment_email_products(payment: Payments) -> list[PaymentProductItem]:
    return [
        PaymentProductItem(
            name=pp.product_name,
            price=float(pp.product_price),
            quantity=pp.quantity,
        )
        for pp in payment.products_snapshot
    ]


def _build_payment_email_attendees(
    payment: Payments,
) -> list[PaymentAttendeeItem] | None:
    if not payment.products_snapshot:
        return None

    attendees_by_id: dict[uuid.UUID, PaymentAttendeeItem] = {}

    for product_snapshot in payment.products_snapshot:
        attendee = product_snapshot.attendee
        attendee_id = product_snapshot.attendee_id

        if attendee_id not in attendees_by_id:
            attendees_by_id[attendee_id] = PaymentAttendeeItem(
                name=(attendee.name if attendee else None)
                or product_snapshot.attendee_name
                or "Attendee",
                category=(attendee.category if attendee else None) or "attendee",
                products=[],
            )

        attendees_by_id[attendee_id].products = [
            *(attendees_by_id[attendee_id].products or []),
            PaymentProductItem(
                name=product_snapshot.product_name,
                price=float(product_snapshot.product_price),
                quantity=product_snapshot.quantity,
            ),
        ]

    return list(attendees_by_id.values())


def _build_payment_confirmed_context(
    payment: Payments,
    popup_name: str,
    first_name: str,
    portal_url: str | None,
) -> PaymentConfirmedContext:
    products = _build_payment_email_products(payment)
    attendees = _build_payment_email_attendees(payment)

    original_amount = None
    if payment.discount_value and payment.discount_value > 0:
        original_amount = sum(
            float(pp.product_price) * pp.quantity for pp in payment.products_snapshot
        )

    return PaymentConfirmedContext(
        first_name=first_name,
        popup_name=popup_name,
        payment_id=str(payment.id),
        amount=float(payment.amount),
        currency=payment.currency,
        products=products if products else None,
        discount_value=int(payment.discount_value) if payment.discount_value else None,
        original_amount=original_amount,
        attendees=attendees,
        order_summary=compute_order_summary(payment) if payment.products_snapshot else None,
        portal_url=portal_url,
    )


async def _send_payment_confirmed_email(payment, db_session=None) -> None:
    """Send payment confirmation email.

    If the popup has invoice details configured (company name, address, email),
    an invoice PDF is generated and attached to the email.

    Branches on payment.application_id:
    - application-based: resolve human via payment.application.human.
    - direct-sale: resolve human via the attendee in the first product snapshot,
      and popup via payment.popup.
    """
    from loguru import logger

    payment_model: Payments = payment

    if payment_model.application_id is not None:
        # Application-based payment (existing flow)
        application = payment_model.application
        human = application.human if application else None
        popup = application.popup if application else None
    else:
        # Direct-sale payment: no application. Human comes from the attendee
        # linked to the first product snapshot (direct-sale only ever has one
        # attendee per payment — the buyer).
        popup = payment_model.popup
        human = None
        if payment_model.products_snapshot:
            attendee = payment_model.products_snapshot[0].attendee
            if attendee is not None:
                human = attendee.human

    if popup is None:
        logger.warning(
            f"Cannot send payment confirmed email: popup missing for payment {payment.id}"
        )
        return
    tenant = popup.tenant

    if not human or not human.email:
        logger.warning(
            f"Cannot send payment confirmed email: no human email for payment {payment.id}"
        )
        return

    # Generate invoice PDF attachment if popup has invoice details configured
    attachments: list[EmailAttachment] | None = None
    popup_has_invoice = (
        popup.invoice_company_name
        and popup.invoice_company_address
        and popup.invoice_company_email
    )
    if popup_has_invoice:
        try:
            from app.core.invoice import generate_invoice_pdf

            client_name = f"{human.first_name or ''} {human.last_name or ''}".strip()

            pdf_bytes = generate_invoice_pdf(
                payment=payment_model,
                client_name=client_name or "N/A",
                invoice_company_name=popup.invoice_company_name,
                invoice_company_address=popup.invoice_company_address,
                invoice_company_email=popup.invoice_company_email,
                header_image_url=popup.image_url,
            )
            attachments = [
                EmailAttachment(
                    filename=f"invoice-{payment_model.id}.pdf",
                    content=pdf_bytes,
                    mime_type="application/pdf",
                )
            ]
            logger.info(f"Invoice PDF generated for payment {payment_model.id}")
        except Exception as e:
            logger.error(
                f"Failed to generate invoice PDF for payment {payment_model.id}: {e}"
            )
            # Continue sending email without attachment

    email_service = get_email_service()

    from app.api.tenant.utils import get_portal_url

    portal_url = get_portal_url(tenant)
    context = _build_payment_confirmed_context(
        payment_model,
        popup_name=popup.name,
        first_name=human.first_name or "",
        portal_url=portal_url,
    )

    await email_service.send_payment_confirmed(
        to=human.email,
        subject=f"Payment Confirmed for {popup.name}",
        context=context,
        from_address=tenant.sender_email,
        from_name=tenant.sender_name,
        popup_id=popup.id,
        db_session=db_session,
        attachments=attachments,
    )
    logger.info(
        f"Payment confirmed email sent to {human.email} for payment {payment.id}"
    )


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
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    external_id: str | None = None,
    payment_status: PaymentStatus | None = None,
    search: str | None = None,
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
        )
    else:
        filters = PaymentFilter(
            application_id=application_id,
            external_id=external_id,
            status=payment_status,
        )
        payments, total = payments_crud.find_by_filter(
            db, filters=filters, skip=skip, limit=limit
        )

    return ListModel[PaymentPublic](
        results=[PaymentPublic.model_validate(p) for p in payments],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{payment_id}", response_model=PaymentPublic)
async def get_payment(
    payment_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
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
    db: TenantSession,
    _: CurrentUser,
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
    _current_user: CurrentWriter,
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

    popup = application.popup
    payment = payments_crud.create_fee_payment(db, application, popup)
    return PaymentPublic.model_validate(payment)


@router.get("/my/latest", response_model=PaymentStatusCheck)
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


@router.get("/my/{payment_id}/status", response_model=PaymentStatusCheck)
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


@router.get("/my/{application_id}", response_model=ListModel[PaymentPublic])
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


@router.get("/my/{payment_id}/invoice")
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


@router.post("/my/preview", response_model=PaymentPreview)
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
)
async def create_my_payment(
    payment_in: PaymentCreate,
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

    payment, _preview = payments_crud.create_payment(db, payment_in)

    return PaymentPublic.model_validate(payment)


@router.post(
    "/direct",
    response_model=PaymentPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_direct_payment(
    purchase_in: DirectPurchaseCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PaymentPublic:
    """Create a direct-sale payment for the current human (Portal).

    Used for popups with sale_type="direct". No application required. The
    server resolves the Attendee from CurrentHuman automatically and creates
    a SimpleFI payment request (or auto-approves if the total is zero).
    """
    from app.api.human.crud import humans_crud
    from app.api.tenant.crud import tenants_crud

    # Load human + tenant (the request session is already tenant-scoped, but
    # we need the Tenants ORM instance for the SimpleFI call)
    human = humans_crud.get(db, current_human.id)
    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )
    tenant = tenants_crud.get(db, current_human.tenant_id)
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    payment = payments_crud.create_direct_payment(
        db, obj=purchase_in, human=human, tenant=tenant
    )
    return PaymentPublic.model_validate(payment)


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

    raw_body = await request.json()
    event_type = raw_body.get("event_type")
    logger.info("SimpleFI webhook received, event_type: {}", event_type)

    if event_type == "installment_plan_completed":
        return await _handle_installment_plan_completed(raw_body, db, webhook_cache)

    if event_type == "installment_plan_activated":
        return await _handle_installment_plan_activated(raw_body, db, webhook_cache)

    if event_type == "installment_plan_cancelled":
        return await _handle_installment_plan_cancelled(raw_body, db, webhook_cache)

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
        "Regular payment - payment_request_id: %s, event_type: %s",
        payment_request_id,
        event_type,
    )

    payment = payments_crud.get_by_external_id(db, payment_request_id)
    if not payment:
        logger.warning("Payment not found for external_id: {}", payment_request_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    payment_request_status = payload.data.payment_request.status

    if payment.status == payment_request_status:
        logger.info(
            "Payment status unchanged (%s). Skipping...", payment_request_status
        )
        return {"message": "Payment status unchanged"}

    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

    if payment_request_status == "approved":
        from app.api.payment.schemas import PaymentType

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
            await _send_payment_confirmed_email(payment, db_session=db)
        logger.info("Payment {} approved via SimpleFI webhook", payment.id)
    else:
        payments_crud.update(db, payment, PaymentUpdate(status=PaymentStatus.EXPIRED))
        logger.info(
            "Payment %s marked as expired (status: %s)",
            payment.id,
            payment_request_status,
        )

    return {"message": "Payment status updated successfully"}


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

    # Extract payment details
    settlement_currency, settlement_rate, source = _extract_settlement_details(payload)

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
        await _send_payment_confirmed_email(payment, db_session=db)
        return {"message": "Installment plan completed - count synced"}

    # Edge case: plan completed but payment not approved
    logger.warning(
        "Payment %s not approved when installment_plan_completed received", payment.id
    )
    payment.installments_paid = installment_plan.paid_installments_count
    payment = payments_crud.approve_payment(db, payment.id)
    await _send_payment_confirmed_email(payment, db_session=db)

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
    payment.installments_total = installment_plan.number_of_installments
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

    # Idempotent: skip if already cancelled
    if payment.status == "cancelled":
        logger.info("Payment {} already cancelled. Skipping...", payment.id)
        return {"message": "Payment already cancelled"}

    # If payment was approved, revoke products
    if payment.status == "approved":
        logger.info("Revoking products for cancelled payment {}", payment.id)
        payments_crud._remove_products_from_attendees(db, payment)

    payment.status = "cancelled"
    db.commit()

    logger.info("Payment {} cancelled", payment.id)
    return {"message": "Installment plan cancelled successfully"}
