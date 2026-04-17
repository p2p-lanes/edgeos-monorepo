import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from loguru import logger
from sqlalchemy import desc
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.application.models import Applications

if TYPE_CHECKING:
    from app.api.group.models import Groups
    from app.api.human.models import Humans
    from app.api.payment.schemas import DirectPurchaseCreate
    from app.api.tenant.models import Tenants
from app.api.application.schemas import ApplicationStatus, ScholarshipStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.coupon.crud import coupons_crud
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import (
    PaymentCreate,
    PaymentFilter,
    PaymentPreview,
    PaymentProductRequest,
    PaymentSource,
    PaymentStatus,
    PaymentUpdate,
)
from app.api.product.models import Products
from app.api.shared.crud import BaseCRUD

# Decimal precision for money calculations
MONEY_PRECISION = Decimal("0.01")


def _get_discounted_price(price: Decimal, discount_value: Decimal) -> Decimal:
    """Apply discount percentage to a price."""
    return (price * (1 - discount_value / 100)).quantize(
        MONEY_PRECISION, rounding=ROUND_HALF_UP
    )


def _get_credit(application: Applications, discount_value: Decimal) -> Decimal:
    """Calculate credit from previously paid products."""
    total = Decimal("0")
    for attendee in application.attendees:
        patreon = False
        subtotal = Decimal("0")
        for ap in attendee.attendee_products:
            if ap.product.category == "patreon":
                patreon = True
                subtotal = Decimal("0")
            elif not patreon:
                subtotal += ap.product.price * ap.quantity
        if not patreon:
            total += subtotal

    credit = Decimal(str(application.credit)) if application.credit else Decimal("0")
    return _get_discounted_price(total, discount_value) + credit


def _calculate_amounts(
    session: Session,
    requested_products: list[PaymentProductRequest],
    already_patreon: bool,
) -> tuple[Decimal, Decimal, Decimal]:
    """
    Calculate standard, supporter, and patreon amounts.

    Returns: (standard_amount, supporter_amount, patreon_amount)
    """
    product_ids = list({rp.product_id for rp in requested_products})
    statement = select(Products).where(Products.id.in_(product_ids))  # type: ignore[attr-defined]
    product_models = {p.id: p for p in session.exec(statement).all()}

    attendees: dict[uuid.UUID, dict[str, Decimal]] = {}
    for req_prod in requested_products:
        product_model = product_models.get(req_prod.product_id)
        if not product_model:
            logger.error(f"Product model not found for ID: {req_prod.product_id}")
            continue

        quantity = req_prod.quantity
        attendee_id = req_prod.attendee_id
        if attendee_id not in attendees:
            attendees[attendee_id] = {
                "standard": Decimal("0"),
                "supporter": Decimal("0"),
                "patreon": Decimal("0"),
            }

        # Skip if this attendee already has patreon in this order
        if attendees[attendee_id]["patreon"] > 0:
            continue

        if product_model.category == "patreon":
            attendees[attendee_id]["patreon"] = (
                product_model.price * quantity if not already_patreon else Decimal("0")
            )
            attendees[attendee_id]["standard"] = Decimal("0")
            attendees[attendee_id]["supporter"] = Decimal("0")
        elif product_model.category == "supporter":
            attendees[attendee_id]["supporter"] += product_model.price * quantity
        else:
            attendees[attendee_id]["standard"] += product_model.price * quantity

    standard_amount = sum((a["standard"] for a in attendees.values()), Decimal("0"))
    supporter_amount = sum((a["supporter"] for a in attendees.values()), Decimal("0"))
    patreon_amount = sum((a["patreon"] for a in attendees.values()), Decimal("0"))

    logger.info(
        "Amounts calculated - Standard: {}, Supporter: {}, Patreon: {}",
        standard_amount,
        supporter_amount,
        patreon_amount,
    )

    return standard_amount, supporter_amount, patreon_amount


def _calculate_price(
    standard_amount: Decimal,
    supporter_amount: Decimal,
    patreon_amount: Decimal,
    discount_value: Decimal,
    application: Applications,
    edit_passes: bool,
) -> Decimal:
    """Calculate final price with discounts and credits."""
    credit = _get_credit(application, discount_value) if edit_passes else Decimal("0")
    logger.info("Credit applied: {}", credit)

    discounted_standard = standard_amount
    if standard_amount > 0:
        discounted_standard = _get_discounted_price(standard_amount, discount_value)
    discounted_standard = discounted_standard - credit

    return discounted_standard + supporter_amount + patreon_amount


class PaymentsCRUD(BaseCRUD[Payments, PaymentCreate, PaymentUpdate]):
    """CRUD operations for Payments."""

    def __init__(self) -> None:
        super().__init__(Payments)

    def get_by_external_id(self, session: Session, external_id: str) -> Payments | None:
        """Get a payment by external ID."""
        statement = select(Payments).where(Payments.external_id == external_id)
        return session.exec(statement).first()

    def find_by_application(
        self,
        session: Session,
        application_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Payments], int]:
        """Find payments by application_id."""
        statement = select(Payments).where(Payments.application_id == application_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(desc(Payments.created_at))  # type: ignore[arg-type]
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def get_latest_by_application(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> Payments | None:
        """Get the most recent payment for an application."""
        statement = (
            select(Payments)
            .where(Payments.application_id == application_id)
            .order_by(desc(Payments.created_at))  # type: ignore[arg-type]
            .limit(1)
        )
        return session.exec(statement).first()

    def get_latest_fee_payment(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> Payments | None:
        """Get the most recent application_fee payment for an application."""
        from app.api.payment.schemas import PaymentType

        statement = (
            select(Payments)
            .where(
                Payments.application_id == application_id,
                Payments.payment_type == PaymentType.APPLICATION_FEE.value,
            )
            .order_by(desc(Payments.created_at))  # type: ignore[arg-type]
            .limit(1)
        )
        return session.exec(statement).first()

    def create_fee_payment(
        self,
        session: Session,
        application: "Applications",
        popup: object,
    ) -> Payments:
        """Create an application fee payment for an application in PENDING_FEE status.

        Validates application status, popup configuration, and absence of an existing
        pending fee payment before creating a new one via SimpleFI.
        """
        from app.api.application.schemas import ApplicationStatus
        from app.api.payment.schemas import PaymentStatus, PaymentType
        from app.api.tenant.utils import get_portal_url

        # 1. Validate application is pending fee
        if application.status != ApplicationStatus.PENDING_FEE.value:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Application is not awaiting fee payment",
            )

        # 2. Validate popup is configured for fee
        if not getattr(popup, "requires_application_fee", False) or not getattr(popup, "application_fee_amount", None) or popup.application_fee_amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Popup is not configured to require an application fee",
            )

        # 3. Check for existing pending fee payment
        existing = self.get_latest_fee_payment(session, application.id)
        if existing and existing.status == PaymentStatus.PENDING.value:
            if not getattr(popup, "simplefi_api_key", None):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment provider not configured for this popup",
                )

            from app.services.simplefi import get_simplefi_client

            simplefi_client = get_simplefi_client(popup.simplefi_api_key)

            if existing.external_id:
                try:
                    remote_payment = simplefi_client.get_payment_request_status(
                        existing.external_id
                    )
                    remote_status = (remote_payment.status or "").lower()

                    if remote_status == PaymentStatus.PENDING.value:
                        raise HTTPException(
                            status_code=status.HTTP_409_CONFLICT,
                            detail=f"A pending fee payment already exists. Checkout URL: {existing.checkout_url}",
                        )

                    status_map = {
                        "approved": PaymentStatus.APPROVED.value,
                        "rejected": PaymentStatus.REJECTED.value,
                        "expired": PaymentStatus.EXPIRED.value,
                        "cancelled": PaymentStatus.CANCELLED.value,
                        "canceled": PaymentStatus.CANCELLED.value,
                    }
                    existing.status = status_map.get(
                        remote_status, PaymentStatus.EXPIRED.value
                    )
                    session.add(existing)
                    session.commit()
                    session.refresh(existing)
                except HTTPException:
                    raise
                except Exception as exc:
                    logger.warning(
                        "Failed to sync existing fee payment {} with SimpleFI: {}. Creating a new fee payment instead.",
                        existing.id,
                        exc,
                    )
                    existing.status = PaymentStatus.EXPIRED.value
                    session.add(existing)
                    session.commit()
                    session.refresh(existing)

        # 4. Snapshot fee amount from popup
        fee_amount = Decimal(str(popup.application_fee_amount))

        # 5. Validate SimpleFI is configured
        if not getattr(popup, "simplefi_api_key", None):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment provider not configured for this popup",
            )

        from app.services.simplefi import get_simplefi_client

        simplefi_client = get_simplefi_client(popup.simplefi_api_key)

        # Build success/cancel paths for fee flow
        portal_base = get_portal_url(popup.tenant)
        success_path = f"{portal_base}/portal/{popup.slug}/application?checkout=success"
        cancel_path = f"{portal_base}/portal/{popup.slug}/application"

        reference = {
            "email": application.human.email if application.human else "",
            "application_id": str(application.id),
            "type": "application_fee",
        }

        try:
            simplefi_response = simplefi_client.create_payment(
                amount=fee_amount,
                popup_slug=popup.slug,
                tenant_slug=popup.tenant.slug,
                reference=reference,
                memo=f"Application fee – {popup.name}",
                portal_base_override=portal_base,
                success_path=success_path,
                cancel_path=cancel_path,
            )
        except Exception as e:
            logger.error(f"Failed to create SimpleFI fee payment: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to create payment with payment provider",
            ) from e

        # 6. Create Payment with payment_type=APPLICATION_FEE, no PaymentProducts
        payment = Payments(
            tenant_id=application.tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            status=simplefi_response.status,
            amount=fee_amount,
            currency="USD",
            external_id=simplefi_response.id,
            checkout_url=simplefi_response.checkout_url,
            source=PaymentSource.SIMPLEFI.value,
            payment_type=PaymentType.APPLICATION_FEE.value,
        )
        session.add(payment)
        session.commit()
        session.refresh(payment)

        return payment

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        status_filter: PaymentStatus | None = None,
    ) -> tuple[list[Payments], int]:
        """Find payments by popup_id via the denormalized popup_id column.

        Covers both application-based payments (popup_id backfilled) and
        direct-sale payments (popup_id set at creation, no application_id).
        """
        statement = select(Payments).where(Payments.popup_id == popup_id)
        if status_filter:
            statement = statement.where(Payments.status == status_filter.value)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(desc(Payments.created_at))  # type: ignore[arg-type]
        statement = statement.offset(skip).limit(limit)
        statement = statement.options(
            selectinload(Payments.products_snapshot).selectinload(
                PaymentProducts.attendee
            ),  # type: ignore[arg-type]
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_filter(
        self,
        session: Session,
        filters: PaymentFilter,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Payments], int]:
        """Find payments with filters."""
        statement = select(Payments)

        if filters.application_id:
            statement = statement.where(
                Payments.application_id == filters.application_id
            )
        if filters.external_id:
            statement = statement.where(Payments.external_id == filters.external_id)
        if filters.status:
            statement = statement.where(Payments.status == filters.status.value)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(desc(Payments.created_at))  # type: ignore[arg-type]
        statement = statement.offset(skip).limit(limit)
        statement = statement.options(
            selectinload(Payments.products_snapshot).selectinload(
                PaymentProducts.attendee
            ),  # type: ignore[arg-type]
        )
        results = list(session.exec(statement).all())

        return results, total

    def _validate_application(self, application: Applications) -> None:
        """Validate that the application is in a valid state for payment.

        Applications must be ACCEPTED before any products can be purchased.
        This implements purchase gating based on the approval strategy.
        """
        if application.status != ApplicationStatus.ACCEPTED.value:
            logger.error(
                "Application %s from %s is not accepted (status: %s)",
                application.id,
                application.human.email if application.human else "unknown",
                application.status,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Application must be accepted before purchasing products",
            )

    def _validate_products(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
        application: Applications,
    ) -> list[Products]:
        """Validate that all requested products are valid and active."""
        product_ids = [p.product_id for p in requested_products]
        statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.popup_id == application.popup_id,
            Products.is_active == True,  # noqa: E712
        )
        valid_products = list(session.exec(statement).all())

        if {p.id for p in valid_products} != set(product_ids):
            logger.error(
                "Some products are not available. Requested: %s, Valid: %s",
                product_ids,
                [p.id for p in valid_products],
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Some products are not available or inactive",
            )

        return valid_products

    def _validate_product_availability(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
        valid_products: list[Products],
    ) -> None:
        """Validate that requested quantities don't exceed product max_quantity.

        Checks against already sold (approved) and reserved (pending) quantities.
        """
        products_map = {p.id: p for p in valid_products}

        # Get product IDs that have max_quantity set
        product_ids_with_limit = [
            p.id for p in valid_products if p.max_quantity is not None
        ]
        if not product_ids_with_limit:
            return

        # Count sold quantities (approved payments) for products with limits
        sold_statement = (
            select(
                PaymentProducts.product_id,
                func.sum(PaymentProducts.quantity).label("total_sold"),
            )
            .join(Payments, PaymentProducts.payment_id == Payments.id)
            .where(
                PaymentProducts.product_id.in_(product_ids_with_limit),  # type: ignore[attr-defined]
                Payments.status.in_(  # type: ignore[attr-defined]
                    [PaymentStatus.APPROVED.value, PaymentStatus.PENDING.value]
                ),
            )
            .group_by(PaymentProducts.product_id)
        )
        sold_results = session.exec(sold_statement).all()
        sold_map: dict[uuid.UUID, int] = {
            row.product_id: int(row.total_sold) for row in sold_results
        }

        # Aggregate requested quantities per product
        requested_map: dict[uuid.UUID, int] = {}
        for req_prod in requested_products:
            if req_prod.product_id in product_ids_with_limit:
                requested_map[req_prod.product_id] = (
                    requested_map.get(req_prod.product_id, 0) + req_prod.quantity
                )

        # Check availability for each product
        for product_id, requested_qty in requested_map.items():
            product = products_map[product_id]
            max_qty = product.max_quantity
            sold_qty = sold_map.get(product_id, 0)
            available_qty = max_qty - sold_qty  # type: ignore[operator]

            if requested_qty > available_qty:
                logger.error(
                    "Product %s (%s) quantity exceeded. "
                    "Requested: %d, Available: %d, Max: %d, Sold: %d",
                    product.name,
                    product_id,
                    requested_qty,
                    available_qty,
                    max_qty,
                    sold_qty,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Product '{product.name}' has insufficient availability. "
                    f"Requested: {requested_qty}, Available: {available_qty}",
                )

    def _validate_attendees(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
        application: Applications,
    ) -> None:
        """Validate that all attendees belong to this application."""
        attendee_ids = {p.attendee_id for p in requested_products}
        statement = select(Attendees).where(
            Attendees.id.in_(attendee_ids),  # type: ignore[attr-defined]
            Attendees.application_id == application.id,
        )
        valid_attendees = list(session.exec(statement).all())

        if len(valid_attendees) != len(attendee_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Some attendees do not belong to this application",
            )

    def _check_patreon_status(
        self,
        application: Applications,
        valid_products: list[Products],
        edit_passes: bool,
    ) -> bool:
        """Check if application already has patreon and validate patreon rules."""
        # Get all products from all attendees
        application_products = application.get_all_products()
        already_patreon = any(p.category == "patreon" for p in application_products)

        is_buying_patreon = any(p.category == "patreon" for p in valid_products)

        if edit_passes and is_buying_patreon and not already_patreon:
            logger.error(
                "Cannot edit passes for Patreon products. %s",
                application.email,  # type: ignore[attr-defined]
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit passes for Patreon products",
            )

        return already_patreon

    def _calculate_insurance(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
    ) -> Decimal:
        """Calculate insurance amount based on product insurance percentages."""
        product_ids = list({rp.product_id for rp in requested_products})
        statement = select(Products).where(Products.id.in_(product_ids))  # type: ignore[attr-defined]
        product_models = {p.id: p for p in session.exec(statement).all()}

        total = Decimal("0")
        for req_prod in requested_products:
            product = product_models.get(req_prod.product_id)
            if not product or not product.insurance_percentage:
                continue
            total += (
                product.price * req_prod.quantity * product.insurance_percentage / 100
            ).quantize(MONEY_PRECISION, rounding=ROUND_HALF_UP)

        return total

    def _apply_discounts(
        self,
        session: Session,
        obj: PaymentCreate,
        application: Applications,
        already_patreon: bool,
    ) -> PaymentPreview:
        """Calculate all discounts and return payment preview."""
        discount_assigned = Decimal("0")

        response = PaymentPreview(
            application_id=application.id,
            products=obj.products,
            original_amount=Decimal("0"),
            amount=Decimal("0"),
            currency="USD",
            edit_passes=obj.edit_passes,
            discount_value=discount_assigned,
        )

        standard_amount, supporter_amount, patreon_amount = _calculate_amounts(
            session,
            obj.products,
            already_patreon,
        )

        response.original_amount = standard_amount + supporter_amount + patreon_amount
        response.amount = _calculate_price(
            standard_amount=standard_amount,
            supporter_amount=supporter_amount,
            patreon_amount=patreon_amount,
            discount_value=discount_assigned,
            application=application,
            edit_passes=obj.edit_passes,
        )

        # Check group discount
        if application.group:
            response.group_id = application.group.id
            group_discount = application.group.discount_percentage or Decimal("0")
            discounted_amount = _calculate_price(
                standard_amount=standard_amount,
                supporter_amount=supporter_amount,
                patreon_amount=patreon_amount,
                discount_value=group_discount,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount < response.amount:
                response.amount = discounted_amount
                response.discount_value = group_discount

        # Check coupon code
        if obj.coupon_code:
            coupon = coupons_crud.validate_coupon(
                session,
                code=obj.coupon_code,
                popup_id=application.popup_id,
            )
            coupon_discount = Decimal(str(coupon.discount_value))
            discounted_amount = _calculate_price(
                standard_amount=standard_amount,
                supporter_amount=supporter_amount,
                patreon_amount=patreon_amount,
                discount_value=coupon_discount,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount < response.amount:
                response.amount = discounted_amount
                response.coupon_id = coupon.id
                response.coupon_code = coupon.code
                response.discount_value = coupon_discount

        # Check scholarship discount (third competitor — best-of-three)
        if (
            application.scholarship_status == ScholarshipStatus.APPROVED.value
            and application.discount_percentage
        ):
            scholarship_discount_pct = Decimal(str(application.discount_percentage))
            discounted_amount = _calculate_price(
                standard_amount=standard_amount,
                supporter_amount=supporter_amount,
                patreon_amount=patreon_amount,
                discount_value=scholarship_discount_pct,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount <= response.amount:
                response.amount = discounted_amount
                response.discount_value = scholarship_discount_pct
                response.coupon_id = None
                response.coupon_code = None
                response.group_id = None
                response.scholarship_discount = True

        # Calculate insurance if requested
        if obj.insurance:
            insurance_amount = self._calculate_insurance(session, obj.products)
            response.insurance_amount = insurance_amount
            response.amount += insurance_amount

        return response

    def preview_payment(
        self,
        session: Session,
        obj: PaymentCreate,
    ) -> PaymentPreview:
        """
        Preview a payment without creating it.

        Returns calculated amounts with discounts applied.
        """
        application = self._get_application_with_products(session, obj.application_id)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        self._validate_application(application)
        valid_products = self._validate_products(session, obj.products, application)
        self._validate_attendees(session, obj.products, application)
        self._validate_product_availability(session, obj.products, valid_products)
        already_patreon = self._check_patreon_status(
            application, valid_products, obj.edit_passes
        )

        return self._apply_discounts(session, obj, application, already_patreon)

    def _get_application_with_products(
        self, session: Session, application_id: uuid.UUID
    ) -> Applications | None:
        """Get application with eager loaded attendees, products, and popup.

        This avoids N+1 queries when calculating credits, checking patreon status,
        and accessing popup settings (e.g., simplefi_api_key).
        """
        statement = (
            select(Applications)
            .where(Applications.id == application_id)
            .options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # ty: ignore[invalid-argument-type]
                .selectinload(AttendeeProducts.product),  # ty: ignore[invalid-argument-type]
                selectinload(Applications.human),  # type: ignore[arg-type]
                selectinload(Applications.group),  # type: ignore[arg-type]
                selectinload(Applications.popup),  # type: ignore[arg-type]
            )
        )
        return session.exec(statement).first()

    def create_payment(
        self,
        session: Session,
        obj: PaymentCreate,
    ) -> tuple[Payments, PaymentPreview]:
        """
        Create a payment with all validations and discount calculations.

        For zero-amount payments, auto-approves and adds products directly.
        For paid payments, returns payment with checkout info from SimpleFI.
        """
        preview = self.preview_payment(session, obj)

        # Use eager loading to avoid N+1 when accessing application relationships
        application = self._get_application_with_products(session, obj.application_id)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        # Handle zero or negative amount (credit covers cost)
        if preview.amount <= 0:
            if preview.amount < 0:
                # Store remaining credit
                application.credit = float(-preview.amount)
                preview.amount = Decimal("0")
            else:
                application.credit = 0.0

            # Clear existing products if editing passes
            if obj.edit_passes:
                # Build a temporary payment-like object to reuse _clear_application_products
                attendee_ids = {p.attendee_id for p in obj.products}
                statement = select(AttendeeProducts).where(
                    AttendeeProducts.attendee_id.in_(attendee_ids)  # type: ignore[attr-defined]
                )
                existing_products = list(session.exec(statement).all())
                for ap in existing_products:
                    session.delete(ap)
                session.flush()

            # Auto-approve and add products directly
            self._add_products_to_attendees(session, obj.products)

            # Get product details for snapshot
            product_ids = [p.product_id for p in obj.products]
            prod_statement = select(Products).where(Products.id.in_(product_ids))  # type: ignore[attr-defined]
            products_map = {p.id: p for p in session.exec(prod_statement).all()}

            # Create payment record for audit trail
            payment = Payments(
                tenant_id=application.tenant_id,
                application_id=obj.application_id,
                popup_id=application.popup_id,
                status=PaymentStatus.APPROVED.value,
                amount=preview.amount,
                insurance_amount=preview.insurance_amount,
                currency=preview.currency,
                coupon_id=preview.coupon_id,
                coupon_code=preview.coupon_code,
                discount_value=preview.discount_value,
                edit_passes=obj.edit_passes,
                group_id=preview.group_id,
                source=None,
            )
            session.add(payment)
            session.flush()

            # Create product snapshots
            for req_prod in obj.products:
                product = products_map.get(req_prod.product_id)
                if product:
                    payment_product = PaymentProducts(
                        tenant_id=application.tenant_id,
                        payment_id=payment.id,
                        product_id=req_prod.product_id,
                        attendee_id=req_prod.attendee_id,
                        quantity=req_prod.quantity,
                        product_name=product.name,
                        product_description=product.description,
                        product_price=product.price,
                        product_category=product.category or "",
                    )
                    session.add(payment_product)

            # Increment coupon usage if used
            if preview.coupon_id:
                coupons_crud.use_coupon(session, preview.coupon_id)

            # Clear cart after successful purchase
            from app.api.cart.crud import carts_crud

            carts_crud.delete_by_human_popup(
                session, human_id=application.human_id, popup_id=application.popup_id
            )

            session.add(application)
            session.commit()
            session.refresh(payment)

            # Return payment with approved status
            preview.status = PaymentStatus.APPROVED.value
            return payment, preview

        # Validate popup has SimpleFI API key configured
        if not application.popup or not application.popup.simplefi_api_key:
            logger.error(
                "Popup %s does not have SimpleFI API key configured",
                application.popup_id,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment provider not configured for this popup",
            )

        # Get product details for snapshot and SimpleFI reference
        product_ids = [p.product_id for p in obj.products]
        statement = select(Products).where(Products.id.in_(product_ids))  # type: ignore[attr-defined]
        products_map = {p.id: p for p in session.exec(statement).all()}

        # Create SimpleFI payment request
        from app.services.simplefi import get_simplefi_client

        simplefi_client = get_simplefi_client(application.popup.simplefi_api_key)

        # Build reference for SimpleFI (useful for debugging/tracking)
        reference = {
            "email": application.human.email if application.human else "",
            "application_id": str(application.id),
            "products": [
                {
                    "product_id": str(req_prod.product_id),
                    "name": products_map[req_prod.product_id].name
                    if req_prod.product_id in products_map
                    else "",
                    "quantity": req_prod.quantity,
                    "attendee_id": str(req_prod.attendee_id),
                }
                for req_prod in obj.products
            ],
        }

        try:
            from app.api.tenant.utils import get_portal_url

            simplefi_response = simplefi_client.create_payment(
                amount=preview.amount,
                popup_slug=application.popup.slug,
                tenant_slug=application.popup.tenant.slug,
                reference=reference,
                memo=application.popup.tenant.name,
                portal_base_override=get_portal_url(application.popup.tenant),
            )
        except Exception as e:
            logger.error(f"Failed to create SimpleFI payment: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to create payment with payment provider",
            ) from e

        # Create payment record with SimpleFI data
        payment = Payments(
            tenant_id=application.tenant_id,
            application_id=obj.application_id,
            popup_id=application.popup_id,
            status=simplefi_response.status,
            amount=preview.amount,
            insurance_amount=preview.insurance_amount,
            currency=preview.currency,
            coupon_id=preview.coupon_id,
            coupon_code=preview.coupon_code,
            discount_value=preview.discount_value,
            edit_passes=obj.edit_passes,
            group_id=preview.group_id,
            external_id=simplefi_response.id,
            checkout_url=simplefi_response.checkout_url,
            source=PaymentSource.SIMPLEFI.value,
        )

        session.add(payment)
        session.flush()  # Get payment ID

        # Create product snapshots
        for req_prod in obj.products:
            product = products_map.get(req_prod.product_id)
            if product:
                payment_product = PaymentProducts(
                    tenant_id=application.tenant_id,
                    payment_id=payment.id,
                    product_id=req_prod.product_id,
                    attendee_id=req_prod.attendee_id,
                    quantity=req_prod.quantity,
                    product_name=product.name,
                    product_description=product.description,
                    product_price=product.price,
                    product_category=product.category or "",
                )
                session.add(payment_product)

        # Increment coupon usage if used
        if preview.coupon_id:
            coupons_crud.use_coupon(session, preview.coupon_id)

        session.commit()
        session.refresh(payment)

        # Update preview with SimpleFI response data
        preview.status = simplefi_response.status
        preview.external_id = simplefi_response.id
        preview.checkout_url = simplefi_response.checkout_url

        return payment, preview

    def create_direct_payment(
        self,
        session: Session,
        obj: "DirectPurchaseCreate",
        human: "Humans",
        tenant: "Tenants",
    ) -> Payments:
        """Create a payment for a direct-sale popup.

        - Validates popup exists, is active, and has sale_type="direct".
        - Validates requested products belong to the popup and are active.
        - Reuses or creates the Attendee record bound to (human, popup).
        - Calculates amount (no application-level discounts in v1 — no group,
          no coupon, no scholarship).
        - Zero-amount purchase: auto-approves, assigns products, no SimpleFI call.
        - Non-zero: creates a SimpleFI payment request and stores the checkout_url.
        """
        from app.api.attendee.crud import attendees_crud
        from app.api.popup.models import Popups
        from app.api.popup.schemas import PopupStatus
        from app.api.shared.enums import SaleType
        from app.api.tenant.utils import get_portal_url
        from app.services.simplefi import get_simplefi_client

        # 1. Validate popup
        popup = session.get(Popups, obj.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        if popup.status != PopupStatus.active.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Popup is not active",
            )
        if popup.sale_type != SaleType.direct.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Popup does not support direct purchases",
            )

        # 2. Validate products belong to popup and are active
        product_ids = [p.product_id for p in obj.products]
        statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.popup_id == popup.id,
            Products.is_active == True,  # noqa: E712
        )
        valid_products = list(session.exec(statement).all())
        if {p.id for p in valid_products} != set(product_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Some products are not available or inactive",
            )

        products_map = {p.id: p for p in valid_products}

        # 3. Validate availability (max_quantity vs sold+pending)
        self._validate_product_availability(
            session,
            [
                # reuse existing helper which expects PaymentProductRequest —
                # we fabricate one with a placeholder attendee_id since the
                # helper only reads product_id and quantity.
                PaymentProductRequest(
                    product_id=p.product_id,
                    attendee_id=uuid.uuid4(),
                    quantity=p.quantity,
                )
                for p in obj.products
            ],
            valid_products,
        )

        # 4. Get or create the direct-sale attendee
        attendee = attendees_crud.find_direct_attendee(
            session, human_id=human.id, popup_id=popup.id
        )
        if not attendee:
            name = (
                f"{human.first_name or ''} {human.last_name or ''}".strip()
                or human.email
            )
            attendee = attendees_crud.create_direct_attendee(
                session,
                human_id=human.id,
                popup_id=popup.id,
                tenant_id=tenant.id,
                name=name,
                email=human.email,
            )

        # 5. Calculate amount (no discount pipeline in v1 for direct-sale)
        amount = Decimal("0")
        for req_prod in obj.products:
            product = products_map[req_prod.product_id]
            amount += product.price * req_prod.quantity
        amount = amount.quantize(MONEY_PRECISION, rounding=ROUND_HALF_UP)

        # 6. Zero-amount: auto-approve, assign products directly
        if amount <= 0:
            payment = Payments(
                tenant_id=tenant.id,
                application_id=None,
                popup_id=popup.id,
                status=PaymentStatus.APPROVED.value,
                amount=Decimal("0"),
                currency="USD",
                source=None,
            )
            session.add(payment)
            session.flush()

            for req_prod in obj.products:
                product = products_map[req_prod.product_id]
                pp = PaymentProducts(
                    tenant_id=tenant.id,
                    payment_id=payment.id,
                    product_id=req_prod.product_id,
                    attendee_id=attendee.id,
                    quantity=req_prod.quantity,
                    product_name=product.name,
                    product_description=product.description,
                    product_price=product.price,
                    product_category=product.category or "",
                )
                session.add(pp)

            self._add_products_to_attendees(
                session,
                [
                    PaymentProductRequest(
                        product_id=rp.product_id,
                        attendee_id=attendee.id,
                        quantity=rp.quantity,
                    )
                    for rp in obj.products
                ],
            )

            session.commit()
            session.refresh(payment)
            return payment

        # 7. Non-zero: create SimpleFI payment request
        if not popup.simplefi_api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment provider not configured for this popup",
            )

        simplefi_client = get_simplefi_client(popup.simplefi_api_key)
        reference = {
            "email": human.email,
            "human_id": str(human.id),
            "popup_id": str(popup.id),
            "type": "direct",
            "products": [
                {
                    "product_id": str(rp.product_id),
                    "name": products_map[rp.product_id].name,
                    "quantity": rp.quantity,
                    "attendee_id": str(attendee.id),
                }
                for rp in obj.products
            ],
        }

        portal_base = get_portal_url(tenant)

        try:
            simplefi_response = simplefi_client.create_payment(
                amount=amount,
                popup_slug=popup.slug,
                tenant_slug=tenant.slug,
                reference=reference,
                memo=f"{popup.name} — direct purchase",
                portal_base_override=portal_base,
            )
        except Exception as e:
            logger.error(f"Failed to create SimpleFI direct payment: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to create payment with payment provider",
            ) from e

        payment = Payments(
            tenant_id=tenant.id,
            application_id=None,
            popup_id=popup.id,
            status=simplefi_response.status,
            amount=amount,
            currency="USD",
            external_id=simplefi_response.id,
            checkout_url=simplefi_response.checkout_url,
            source=PaymentSource.SIMPLEFI.value,
        )
        session.add(payment)
        session.flush()

        for req_prod in obj.products:
            product = products_map[req_prod.product_id]
            pp = PaymentProducts(
                tenant_id=tenant.id,
                payment_id=payment.id,
                product_id=req_prod.product_id,
                attendee_id=attendee.id,
                quantity=req_prod.quantity,
                product_name=product.name,
                product_description=product.description,
                product_price=product.price,
                product_category=product.category or "",
            )
            session.add(pp)

        session.commit()
        session.refresh(payment)
        return payment

    def approve_payment(
        self,
        session: Session,
        payment_id: uuid.UUID,
        *,
        currency: str | None = None,
        rate: Decimal | None = None,
    ) -> Payments:
        """
        Approve a payment and add products to attendees.

        This is called when payment is confirmed (e.g., webhook from payment provider).
        All changes are committed atomically -- on failure, everything is rolled back.
        """
        payment = self.get(session, payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found",
            )

        if payment.status == PaymentStatus.APPROVED.value:
            return payment  # Already approved

        try:
            # Use existing currency or default to USD for manual approvals
            final_currency = currency or payment.currency or "USD"
            source = (
                PaymentSource.STRIPE
                if final_currency == "USD"
                else PaymentSource.SIMPLEFI
            )

            # Set payment fields directly (no intermediate commit)
            payment.status = PaymentStatus.APPROVED.value
            payment.currency = final_currency
            if rate is not None:
                payment.rate = rate
            payment.source = source.value
            session.add(payment)

            # Clear existing products if editing passes
            if payment.edit_passes:
                self._clear_application_products(session, payment)

            # Add products to attendees
            products_to_add = [
                PaymentProductRequest(
                    product_id=pp.product_id,
                    attendee_id=pp.attendee_id,
                    quantity=pp.quantity,
                )
                for pp in payment.products_snapshot
            ]
            self._add_products_to_attendees(session, products_to_add)

            # Create ambassador group if patreon product was purchased.
            # Direct-sale payments have no application — skip ambassador logic
            # (it requires application.human_id for the group leader).
            if payment.application_id is not None:
                self._create_ambassador_group(session, payment)

            # Clear cart after successful payment (application flow only —
            # direct-sale payments don't use the cart).
            from app.api.cart.crud import carts_crud

            if payment.application:
                carts_crud.delete_by_human_popup(
                    session,
                    human_id=payment.application.human_id,
                    popup_id=payment.application.popup_id,
                )

            # Single atomic commit for the entire operation
            session.commit()
            session.refresh(payment)

        except HTTPException:
            session.rollback()
            raise
        except Exception:
            session.rollback()
            logger.exception("Failed to approve payment {}", payment_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to approve payment",
            )

        return payment

    def _clear_application_products(
        self,
        session: Session,
        payment: Payments,
    ) -> None:
        """Clear all existing products for attendees in this payment's application.

        Used when edit_passes=True to replace existing products with new ones.
        """
        # Get all attendee IDs from this payment's products
        attendee_ids = {pp.attendee_id for pp in payment.products_snapshot}

        if not attendee_ids:
            return

        # Delete all AttendeeProducts for these attendees
        statement = select(AttendeeProducts).where(
            AttendeeProducts.attendee_id.in_(attendee_ids)  # type: ignore[attr-defined]
        )
        existing_products = list(session.exec(statement).all())

        for ap in existing_products:
            session.delete(ap)

        session.flush()
        logger.info(
            "Cleared %d existing products for %d attendees (payment %s, edit_passes=True)",
            len(existing_products),
            len(attendee_ids),
            payment.id,
        )

    def _create_ambassador_group(
        self,
        session: Session,
        payment: Payments,
    ) -> "Groups | None":
        """Create an ambassador group when a payment is approved.

        Returns the created group or None if the human already has an ambassador group
        for this popup.
        """
        from app.api.group.crud import groups_crud

        # Get application with popup
        application = session.get(Applications, payment.application_id)
        if not application or not application.human_id:
            logger.warning(
                "Cannot create ambassador group: application or human not found for payment %s",
                payment.id,
            )
            return None

        human = application.human
        popup = application.popup

        if not human or not popup:
            logger.warning(
                "Cannot create ambassador group: missing human or popup for payment %s",
                payment.id,
            )
            return None

        # Check if human already has an ambassador group for this popup
        existing_group = groups_crud.get_ambassador_group(session, popup.id, human.id)
        if existing_group:
            logger.info(
                "Ambassador group already exists for %s",
                human.email,
            )
            return existing_group

        # Build full name
        first_name = human.first_name or ""
        last_name = human.last_name or ""
        full_name = f"{first_name} {last_name}".strip()

        # Create ambassador group using the CRUD service
        group = groups_crud.create_ambassador_group(
            session,
            tenant_id=application.tenant_id,
            popup_id=popup.id,
            popup_slug=popup.slug,
            human_id=human.id,
            human_name=full_name,
        )

        return group

    def _remove_products_from_attendees(
        self,
        session: Session,
        payment: Payments,
    ) -> None:
        """Remove products from attendees that were added by this payment."""
        if not payment.products_snapshot:
            return

        logger.info("Removing products from attendees for payment {}", payment.id)
        for product_snapshot in payment.products_snapshot:
            statement = select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == product_snapshot.attendee_id,
                AttendeeProducts.product_id == product_snapshot.product_id,
            )
            attendee_product = session.exec(statement).first()
            if attendee_product:
                session.delete(attendee_product)

        session.flush()

    def _add_products_to_attendees(
        self,
        session: Session,
        products: list[PaymentProductRequest],
    ) -> None:
        """Add products to attendees after payment approval."""
        # Get tenant_id from first attendee (all should be same tenant)
        if not products:
            return

        first_attendee = session.get(Attendees, products[0].attendee_id)
        if not first_attendee:
            logger.error(f"Attendee not found: {products[0].attendee_id}")
            return

        tenant_id = first_attendee.tenant_id

        for req_prod in products:
            # Check if attendee already has this product
            statement = select(AttendeeProducts).where(
                AttendeeProducts.attendee_id == req_prod.attendee_id,
                AttendeeProducts.product_id == req_prod.product_id,
            )
            existing = session.exec(statement).first()

            if existing:
                # Update quantity
                existing.quantity += req_prod.quantity
                session.add(existing)
            else:
                # Create new link
                attendee_product = AttendeeProducts(
                    tenant_id=tenant_id,
                    attendee_id=req_prod.attendee_id,
                    product_id=req_prod.product_id,
                    quantity=req_prod.quantity,
                )
                session.add(attendee_product)

        session.flush()

    def update_status(
        self,
        session: Session,
        payment_id: uuid.UUID,
        new_status: PaymentStatus,
    ) -> Payments:
        """Update payment status."""
        payment = self.get(session, payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found",
            )

        old_status = payment.status
        payment.status = new_status.value

        # If approving, add products to attendees
        if (
            new_status == PaymentStatus.APPROVED
            and old_status != PaymentStatus.APPROVED.value
        ):
            products_to_add = [
                PaymentProductRequest(
                    product_id=pp.product_id,
                    attendee_id=pp.attendee_id,
                    quantity=pp.quantity,
                )
                for pp in payment.products_snapshot
            ]
            self._add_products_to_attendees(session, products_to_add)

        session.add(payment)
        session.commit()
        session.refresh(payment)

        return payment


payments_crud = PaymentsCRUD()
