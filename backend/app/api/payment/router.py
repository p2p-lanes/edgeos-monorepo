import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import (
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
from app.core.config import settings
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
    PaymentConfirmedContext,
    PaymentProductItem,
    get_email_service,
)

router = APIRouter(prefix="/payments", tags=["payments"])


async def _send_payment_confirmed_email(payment, db_session=None) -> None:
    """Send payment confirmation email.

    If the popup has invoice details configured (company name, address, email),
    an invoice PDF is generated and attached to the email.
    """
    from loguru import logger

    payment_model: Payments = payment

    application = payment_model.application
    human = application.human
    popup = application.popup
    tenant = popup.tenant

    if not human or not human.email:
        logger.warning(
            f"Cannot send payment confirmed email: no human email for payment {payment.id}"
        )
        return

    # Build products list from payment snapshot
    products = [
        PaymentProductItem(
            name=pp.product_name,
            price=float(pp.product_price),
            quantity=pp.quantity,
        )
        for pp in payment_model.products_snapshot
    ]

    # Calculate original amount if discount was applied
    original_amount = None
    if payment_model.discount_value and payment_model.discount_value > 0:
        # Sum of all products
        original_amount = sum(
            float(pp.product_price) * pp.quantity
            for pp in payment_model.products_snapshot
        )

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

    portal_host = settings.PORTAL_URL.replace("https://", "").replace("http://", "")
    portal_url = f"https://{tenant.slug}.{portal_host}"

    await email_service.send_payment_confirmed(
        to=human.email,
        subject=f"Payment Confirmed for {popup.name}",
        context=PaymentConfirmedContext(
            first_name=human.first_name or "",
            popup_name=popup.name,
            payment_id=str(payment_model.id),
            amount=float(payment_model.amount),
            currency=payment_model.currency,
            products=products if products else None,
            discount_value=int(payment_model.discount_value)
            if payment_model.discount_value
            else None,
            original_amount=original_amount,
            portal_url=portal_url,
        ),
        from_address=tenant.sender_email,
        from_name=tenant.sender_name,
        popup_id=popup.id,
        db_session=db_session,
        attachments=attachments,
    )
    logger.info(
        f"Payment confirmed email sent to {human.email} for payment {payment.id}"
    )


@router.get("", response_model=ListModel[PaymentPublic])
async def list_payments(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    external_id: str | None = None,
    payment_status: PaymentStatus | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PaymentPublic]:
    """List payments with optional filters (BO only)."""
    if popup_id:
        payments, total = payments_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, status_filter=payment_status
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

    popup = payment.application.popup
    if not (
        popup.invoice_company_name
        and popup.invoice_company_address
        and popup.invoice_company_email
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not available for this event",
        )

    human = payment.application.human
    client_name = f"{human.first_name or ''} {human.last_name or ''}".strip() or "N/A"

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


@router.post("/{payment_id}/approve", response_model=PaymentPublic)
async def approve_payment(
    payment_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> PaymentPublic:
    """Manually approve a payment (BO only)."""

    payment = payments_crud.approve_payment(db, payment_id)

    # Send payment confirmed email
    await _send_payment_confirmed_email(payment, db_session=db)

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
    from app.api.application.crud import applications_crud
    from app.core.invoice import generate_invoice_pdf

    payment = payments_crud.get(db, payment_id)
    if not payment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # Verify human owns this payment's application
    application = applications_crud.get(db, payment.application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # Only generate invoice if popup has all invoice fields configured
    popup = application.popup
    if not (
        popup.invoice_company_name
        and popup.invoice_company_address
        and popup.invoice_company_email
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invoice not available for this event",
        )

    human = application.human
    client_name = f"{human.first_name or ''} {human.last_name or ''}".strip() or "N/A"

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
    application = applications_crud.get(db, payment_in.application_id)
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
    application = applications_crud.get(db, payment_in.application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    payment, _preview = payments_crud.create_payment(db, payment_in)

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
    from decimal import Decimal

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

    # Extract currency and rate from transaction
    currency = "USD"
    rate = Decimal("1")
    if payload.data.new_payment:
        currency = payload.data.new_payment.coin
        for t in payload.data.payment_request.transactions:
            if t.coin == currency:
                rate = Decimal(str(t.price_details.rate))
                break

    if payment_request_status == "approved":
        payment = payments_crud.approve_payment(
            db, payment.id, currency=currency, rate=rate
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


async def _handle_installment_payment(
    payload: SimpleFIWebhookPayload,
    db: Session,
    webhook_cache: WebhookCache,
) -> dict:
    """Handle new_payment/new_card_payment for installment plans."""
    from datetime import UTC, datetime
    from decimal import Decimal

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
    payment = payments_crud.get_by_external_id(db, installment_plan_id)
    if not payment:
        logger.warning("Payment not found for installment plan {}", installment_plan_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment not found",
        )

    # Extract payment details
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
        payment = payments_crud.approve_payment(db, payment.id, currency=currency)
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
    payment = payments_crud.approve_payment(db, payment.id, currency="USD")
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
