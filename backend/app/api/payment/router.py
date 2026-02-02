import uuid
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, status

from app.api.payment.crud import payments_crud
from app.api.payment.schemas import (
    PaymentCreate,
    PaymentFilter,
    PaymentPreview,
    PaymentPublic,
    PaymentStatus,
    PaymentUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    SessionDep,
    TenantSession,
)
from app.services.email import (
    PaymentConfirmedContext,
    PaymentProductItem,
    get_email_service,
)

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic

router = APIRouter(prefix="/payments", tags=["payments"])


def _check_write_permission(current_user: "UserPublic") -> None:
    """Check if user has write permission."""
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role does not have write access",
        )


async def _send_payment_confirmed_email(payment) -> None:
    """Send payment confirmation email."""
    from loguru import logger

    from app.api.payment.models import Payments

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

    email_service = get_email_service()
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
            portal_url=popup.portal_url,
        ),
        from_address=tenant.sender_email,
        from_name=tenant.sender_name,
    )
    logger.info(
        f"Payment confirmed email sent to {human.email} for payment {payment.id}"
    )


# ========================
# BO (Backoffice) Routes
# ========================


@router.get("", response_model=ListModel[PaymentPublic])
async def list_payments(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    application_id: uuid.UUID | None = None,
    external_id: str | None = None,
    payment_status: PaymentStatus | None = None,
    skip: int = 0,
    limit: int = 100,
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


@router.patch("/{payment_id}", response_model=PaymentPublic)
async def update_payment(
    payment_id: uuid.UUID,
    payment_in: PaymentUpdate,
    db: TenantSession,
    current_user: CurrentUser,
) -> PaymentPublic:
    """Update a payment (BO only)."""
    _check_write_permission(current_user)

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
        await _send_payment_confirmed_email(payment)

    return PaymentPublic.model_validate(payment)


@router.post("/{payment_id}/approve", response_model=PaymentPublic)
async def approve_payment(
    payment_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentUser,
) -> PaymentPublic:
    """Manually approve a payment (BO only)."""
    _check_write_permission(current_user)

    payment = payments_crud.approve_payment(db, payment_id)

    # Send payment confirmed email
    await _send_payment_confirmed_email(payment)

    return PaymentPublic.model_validate(payment)


# ========================
# Portal (Human) Routes
# ========================


@router.get("/my/{application_id}", response_model=ListModel[PaymentPublic])
async def list_my_payments(
    application_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
    skip: int = 0,
    limit: int = 100,
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


@router.post("/my/preview", response_model=PaymentPreview)
async def preview_my_payment(
    payment_in: PaymentCreate,
    db: SessionDep,
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
    response_model=PaymentPublic | PaymentPreview,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_payment(
    payment_in: PaymentCreate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> PaymentPublic | PaymentPreview:
    """
    Create a payment for current human's application (Portal).

    If the total is zero or negative (covered by credit), the products
    are immediately assigned and no payment record is created - returns
    PaymentPreview with approved status.

    Otherwise, returns PaymentPublic with checkout URL.
    """
    from app.api.application.crud import applications_crud

    # Verify human owns this application
    application = applications_crud.get(db, payment_in.application_id)
    if not application or application.human_id != current_human.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    payment, preview = payments_crud.create_payment(db, payment_in)

    # Zero-amount payment (covered by credit)
    if payment is None:
        return preview

    # TODO: Create payment with external provider (SimpleFI/Stripe)
    # payment.external_id = external_response["id"]
    # payment.checkout_url = external_response["checkout_url"]
    # payment.status = external_response["status"]
    # db.commit()
    # db.refresh(payment)

    return PaymentPublic.model_validate(payment)


# ========================
# Webhook Routes (for payment providers)
# ========================


@router.post("/webhook/simplefi", status_code=status.HTTP_200_OK)
async def simplefi_webhook(
    _db: SessionDep,
    # TODO: Add proper webhook payload schema
    # payload: SimpleFIWebhookPayload,
) -> dict:
    """
    Webhook endpoint for SimpleFI payment notifications.

    Called by SimpleFI when payment status changes.
    """
    # TODO: Implement webhook handling
    # 1. Validate webhook signature
    # 2. Find payment by external_id
    # 3. Update payment status
    # 4. If approved, add products to attendees
    # 5. Send confirmation email

    return {"status": "ok"}


@router.post("/webhook/stripe", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    _db: SessionDep,
    # TODO: Add proper webhook payload schema
) -> dict:
    """
    Webhook endpoint for Stripe payment notifications.

    Called by Stripe when payment status changes.
    """
    # TODO: Implement webhook handling

    return {"status": "ok"}
