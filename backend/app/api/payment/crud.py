import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from loguru import logger
from sqlalchemy import desc, or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.human.models import Humans

if TYPE_CHECKING:
    from app.api.checkout.schemas import OpenTicketingPurchaseCreate
    from app.api.group.models import Groups
    from app.api.human.models import Humans
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants
from app.api.application.schemas import ApplicationStatus, ScholarshipStatus
from app.api.attendee.crud import generate_check_in_code
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.coupon.crud import coupons_crud
from app.api.form_section.models import FormSections
from app.api.human.crud import humans_crud
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


def calculate_insurance_amount(
    popup: "Any",
    product_quantity_pairs: "list[tuple[Any, int]]",
) -> Decimal:
    """Pure function: compute insurance amount from popup settings + eligible products.

    Args:
        popup: Object with .insurance_enabled (bool) and .insurance_percentage (Decimal|None).
        product_quantity_pairs: List of (product, quantity) where product has
            .price (Decimal) and .insurance_eligible (bool).

    Returns:
        Total insurance amount rounded to 2 decimal places.
        Returns Decimal("0") if insurance is disabled or percentage is None.
    """
    if not popup.insurance_enabled:
        return Decimal("0")
    if popup.insurance_percentage is None:
        return Decimal("0")

    eligible_subtotal = Decimal("0")
    for product, quantity in product_quantity_pairs:
        if product.insurance_eligible:
            eligible_subtotal += product.price * quantity

    return (eligible_subtotal * popup.insurance_percentage / 100).quantize(
        MONEY_PRECISION, rounding=ROUND_HALF_UP
    )


def _require_application_id(application_id: uuid.UUID | None) -> uuid.UUID:
    """Narrow optional application ids for application-based flows."""
    if application_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Application id is required",
        )
    return application_id


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
    statement = select(Products).where(
        Products.id.in_(product_ids),  # type: ignore[attr-defined]
        Products.deleted_at.is_(None),  # type: ignore[attr-defined]
    )
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

    SORT_FIELDS = {"amount", "status", "created_at"}

    def __init__(self) -> None:
        super().__init__(Payments)

    def get_by_external_id(self, session: Session, external_id: str) -> Payments | None:
        """Get a payment by external ID."""
        statement = select(Payments).where(Payments.external_id == external_id)
        return session.exec(statement).first()

    def _validate_open_ticketing_form_data(
        self,
        popup: "Popups",
        form_data: dict[str, Any],
    ) -> None:
        """Validate required buyer fields against the popup form schema."""
        required_field_ids = {
            str(field.id)
            for section in popup.form_sections
            for field in section.form_fields
            if section.kind == "standard" and field.required
        }

        missing = [
            field_id
            for field_id in required_field_ids
            if form_data.get(field_id) in (None, "", [])
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Missing required form fields",
            )

        popup_field_ids = {
            str(field.id)
            for section in popup.form_sections
            for field in section.form_fields
            if section.kind == "standard"
        }
        invalid_ids = [
            field_id for field_id in form_data if field_id not in popup_field_ids
        ]
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Form data contains unknown fields",
            )

    def _build_buyer_snapshot(
        self,
        popup: "Popups",
        form_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Build immutable buyer snapshot JSONB for open ticketing payments."""
        sections_snapshot: list[dict[str, Any]] = []

        ordered_sections = sorted(
            [section for section in popup.form_sections if section.kind == "standard"],
            key=lambda section: section.order,
        )

        for section in ordered_sections:
            ordered_fields = sorted(
                section.form_fields, key=lambda field: field.position
            )
            fields_snapshot = []
            for field in ordered_fields:
                fields_snapshot.append(
                    {
                        "field_id": str(field.id),
                        "field_name": field.name,
                        "field_label": field.label,
                        "field_type": field.field_type,
                        "value": form_data.get(str(field.id)),
                    }
                )

            sections_snapshot.append(
                {
                    "section_id": str(section.id),
                    "section_label": section.label,
                    "section_order": section.order,
                    "fields": fields_snapshot,
                }
            )

        return {
            "schema_version": 1,
            "submitted_at": datetime.now(UTC).isoformat(),
            "sections": sections_snapshot,
        }

    def create_open_ticketing_payment(
        self,
        session: Session,
        obj: "OpenTicketingPurchaseCreate",
        popup: "Popups",
        tenant: "Tenants",
    ) -> tuple[Payments, str]:
        """Create an anonymous open-ticketing payment with per-ticket attendees."""
        from app.api.popup.schemas import PopupStatus
        from app.api.shared.enums import SaleType
        from app.api.tenant.utils import get_portal_url
        from app.services.simplefi import get_simplefi_client

        popup_statement = (
            select(FormSections)
            .where(FormSections.popup_id == popup.id)
            .options(selectinload(FormSections.form_fields))  # ty: ignore[invalid-argument-type]
            .order_by(FormSections.order)  # type: ignore[arg-type]
        )
        popup.form_sections = list(session.exec(popup_statement).all())

        if popup.status != PopupStatus.active.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Popup is not active",
            )
        if popup.sale_type != SaleType.direct.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Popup does not support open ticketing",
            )

        buyer = humans_crud.find_or_create(
            session,
            email=obj.buyer.email,
            tenant_id=tenant.id,
            default_first_name=obj.buyer.first_name,
            default_last_name=obj.buyer.last_name,
        )

        self._validate_open_ticketing_form_data(popup, obj.buyer.form_data)

        product_ids = [line.product_id for line in obj.products]
        products_statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.popup_id == popup.id,
            Products.is_active == True,  # noqa: E712
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
        )
        valid_products = list(session.exec(products_statement).all())
        if {product.id for product in valid_products} != set(product_ids):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Some products are not available or inactive",
            )

        products_map = {product.id: product for product in valid_products}
        fabricated_requests = [
            PaymentProductRequest(
                product_id=line.product_id,
                attendee_id=uuid.uuid4(),
                quantity=line.quantity,
            )
            for line in obj.products
        ]
        self._validate_product_availability(
            session, fabricated_requests, valid_products
        )
        self._decrement_shared_tier_stocks(session, fabricated_requests)

        buyer_snapshot = self._build_buyer_snapshot(popup, obj.buyer.form_data)
        buyer_name = (
            f"{obj.buyer.first_name} {obj.buyer.last_name}".strip() or obj.buyer.email
        )
        amount = Decimal("0")

        payment = Payments(
            tenant_id=tenant.id,
            application_id=None,
            popup_id=popup.id,
            status=PaymentStatus.PENDING.value,
            amount=Decimal("0"),
            currency=popup.currency,
            source=PaymentSource.SIMPLEFI.value,
            buyer_snapshot=buyer_snapshot,
        )
        session.add(payment)
        session.flush()

        created_attendees: list[Attendees] = []
        first_slot = True
        try:
            for line in obj.products:
                product = products_map[line.product_id]
                amount += product.price * line.quantity

                for _ in range(line.quantity):
                    attendee_name = buyer_name if first_slot else ""
                    attendee_email = obj.buyer.email if first_slot else None
                    attendee_category = (
                        "main"
                        if first_slot
                        else (
                            product.attendee_category.value
                            if product.attendee_category
                            else "main"
                        )
                    )

                    attendee = Attendees(
                        tenant_id=tenant.id,
                        application_id=None,
                        popup_id=popup.id,
                        human_id=buyer.id,
                        name=attendee_name,
                        category=attendee_category,
                        email=attendee_email,
                        check_in_code=generate_check_in_code(
                            (popup.slug or "")[:3].upper()
                        ),
                    )
                    session.add(attendee)
                    session.flush()
                    created_attendees.append(attendee)

                    session.add(
                        AttendeeProducts(
                            tenant_id=tenant.id,
                            attendee_id=attendee.id,
                            product_id=product.id,
                            quantity=1,
                        )
                    )
                    session.add(
                        PaymentProducts(
                            tenant_id=tenant.id,
                            payment_id=payment.id,
                            product_id=product.id,
                            attendee_id=attendee.id,
                            quantity=1,
                            product_name=product.name,
                            product_description=product.description,
                            product_price=product.price,
                            product_category=product.category or "",
                            product_currency=popup.currency,
                        )
                    )

                    first_slot = False

            amount = amount.quantize(MONEY_PRECISION, rounding=ROUND_HALF_UP)
            payment.amount = amount

            if not popup.simplefi_api_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment provider not configured for this popup",
                )

            portal_base = get_portal_url(tenant)
            simplefi_client = get_simplefi_client(popup.simplefi_api_key)
            success_url = (
                f"{portal_base}/checkout/{popup.slug}/thank-you?payment_id={payment.id}"
            )
            cancel_url = f"{portal_base}/checkout/{popup.slug}?cancelled=1"
            reference = {
                "email": buyer.email,
                "human_id": str(buyer.id),
                "popup_id": str(popup.id),
                "type": "open_ticketing",
                "payment_id": str(payment.id),
                "products": [
                    {
                        "product_id": str(line.product_id),
                        "name": products_map[line.product_id].name,
                        "quantity": line.quantity,
                    }
                    for line in obj.products
                ],
            }

            simplefi_response = simplefi_client.create_payment(
                amount=amount,
                popup_slug=popup.slug,
                tenant_slug=tenant.slug,
                currency=popup.currency,
                reference=reference,
                memo=f"{popup.name} — open ticketing",
                portal_base_override=portal_base,
                success_path=success_url,
                cancel_path=cancel_url,
            )

            payment.external_id = simplefi_response.id
            payment.status = simplefi_response.status
            payment.checkout_url = simplefi_response.checkout_url
            session.add(payment)
            session.commit()
            session.refresh(payment)
            return payment, simplefi_response.checkout_url
        except HTTPException:
            session.rollback()
            raise
        except Exception as exc:
            session.rollback()
            logger.error(f"Failed to create open ticketing payment: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to create payment with payment provider",
            ) from exc

    def find_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Payments], int]:
        """Find all payments owned by (human_id, popup_id) via dual-path predicate.

        Ownership is resolved through two legs:
        1. Application leg: payment.application.human_id == human_id
           AND payment.popup_id == popup_id (via popup_id denorm column).
        2. Direct-sale leg: payment has no application, but has a PaymentProducts
           row pointing to an Attendee with human_id == human_id AND popup_id == popup_id.

        A UNION of payment IDs from both legs avoids duplicates. Ordered by
        created_at DESC. Returns (rows, total_count) for paginated response.
        """
        from app.api.attendee.models import Attendees

        # Application leg: payment has an application owned by this human for this popup
        app_leg = (
            select(Payments.id)
            .join(Applications, Payments.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
            )
        )

        # Direct-sale leg: payment has a product snapshot linked to an attendee
        # with human_id == human_id and popup_id == popup_id (no application)
        direct_leg = (
            select(Payments.id)
            .join(PaymentProducts, PaymentProducts.payment_id == Payments.id)  # type: ignore[arg-type]
            .join(Attendees, PaymentProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
            .where(
                Attendees.human_id == human_id,
                Attendees.popup_id == popup_id,
                Attendees.application_id.is_(None),  # type: ignore[union-attr]
            )
        )

        union_ids = app_leg.union(direct_leg).subquery()

        count_statement = select(func.count()).where(
            Payments.id.in_(select(union_ids.c.id))  # type: ignore[arg-type]
        )
        total = session.exec(count_statement).one()

        statement = (
            select(Payments)
            .where(Payments.id.in_(select(union_ids.c.id)))  # type: ignore[arg-type]
            .order_by(desc(Payments.created_at))  # type: ignore[arg-type]
            .options(
                selectinload(Payments.products_snapshot).selectinload(  # ty: ignore[invalid-argument-type]
                    PaymentProducts.attendee  # ty: ignore[invalid-argument-type]
                ),
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())
        return results, total

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

    def get_portal_owned_payment(
        self,
        session: Session,
        payment_id: uuid.UUID,
        current_human_id: uuid.UUID,
    ) -> Payments | None:
        """Get a payment owned by the current portal human.

        Ownership rules:
        - Application payment: application.human_id matches current human.
        - Direct-sale payment: any snapshot attendee human_id matches current human.
        """
        statement = (
            select(Payments)
            .where(Payments.id == payment_id)
            .options(
                selectinload(Payments.application).selectinload(Applications.human),  # ty: ignore[invalid-argument-type]
                selectinload(Payments.application).selectinload(Applications.popup),  # ty: ignore[invalid-argument-type]
                selectinload(Payments.popup),  # ty: ignore[invalid-argument-type]
                selectinload(Payments.products_snapshot)  # ty: ignore[invalid-argument-type]
                .selectinload(PaymentProducts.attendee)  # ty: ignore[invalid-argument-type]
                .selectinload(Attendees.human),  # ty: ignore[invalid-argument-type]
            )
        )
        payment = session.exec(statement).first()
        if payment is None:
            return None

        if (
            payment.application is not None
            and payment.application.human_id == current_human_id
        ):
            return payment

        for product_snapshot in payment.products_snapshot:
            attendee = product_snapshot.attendee
            if attendee is not None and attendee.human_id == current_human_id:
                return payment

        return None

    def create_fee_payment(
        self,
        session: Session,
        application: "Applications",
        popup: "Popups",
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
        application_fee_amount = popup.application_fee_amount
        if (
            not popup.requires_application_fee
            or application_fee_amount is None
            or application_fee_amount <= 0
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Popup is not configured to require an application fee",
            )

        # 3. Check for existing pending fee payment
        existing = self.get_latest_fee_payment(session, application.id)
        if existing and existing.status == PaymentStatus.PENDING.value:
            simplefi_api_key = popup.simplefi_api_key
            if not simplefi_api_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment provider not configured for this popup",
                )

            from app.services.simplefi import get_simplefi_client

            simplefi_client = get_simplefi_client(simplefi_api_key)

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
        fee_amount = Decimal(str(application_fee_amount))

        # 5. Validate SimpleFI is configured
        simplefi_api_key = popup.simplefi_api_key
        if not simplefi_api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment provider not configured for this popup",
            )

        from app.services.simplefi import get_simplefi_client

        simplefi_client = get_simplefi_client(simplefi_api_key)

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
            logger.info(
                "Creating SimpleFI application fee payment: application_id={} popup_id={} tenant_id={} amount={} currency={} success_path={} cancel_path={}",
                application.id,
                popup.id,
                application.tenant_id,
                fee_amount,
                popup.currency,
                success_path,
                cancel_path,
            )
            simplefi_response = simplefi_client.create_payment(
                amount=fee_amount,
                popup_slug=popup.slug,
                tenant_slug=popup.tenant.slug,
                currency=popup.currency,
                reference=reference,
                memo=f"Application fee – {popup.name}",
                portal_base_override=portal_base,
                success_path=success_path,
                cancel_path=cancel_path,
            )
            logger.info(
                "SimpleFI application fee payment created: application_id={} external_id={} provider_status={} checkout_url={}",
                application.id,
                simplefi_response.id,
                simplefi_response.status,
                simplefi_response.checkout_url,
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
            currency=popup.currency,
            external_id=simplefi_response.id,
            checkout_url=simplefi_response.checkout_url,
            source=PaymentSource.SIMPLEFI.value,
            payment_type=PaymentType.APPLICATION_FEE.value,
        )
        session.add(payment)
        session.commit()
        session.refresh(payment)

        logger.info(
            "Application fee payment persisted: payment_id={} application_id={} external_id={} status={} amount={}",
            payment.id,
            payment.application_id,
            payment.external_id,
            payment.status,
            payment.amount,
        )

        return payment

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        status_filter: PaymentStatus | None = None,
        search: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[Payments], int]:
        """Find payments by popup_id via the denormalized popup_id column.

        Covers both application-based payments (popup_id backfilled) and
        direct-sale payments (popup_id set at creation, no application_id).
        """
        statement = select(Payments).where(Payments.popup_id == popup_id)
        if status_filter:
            statement = statement.where(Payments.status == status_filter.value)

        normalized_search = search.strip() if search else ""
        if normalized_search:
            pattern = f"%{normalized_search}%"
            attendee_match = (
                select(PaymentProducts.payment_id)
                .join(Attendees, PaymentProducts.attendee_id == Attendees.id)
                .outerjoin(Humans, Attendees.human_id == Humans.id)
                .where(
                    PaymentProducts.payment_id == Payments.id,
                    or_(
                        Attendees.name.ilike(pattern),
                        Attendees.email.ilike(pattern),
                        Humans.email.ilike(pattern),
                    ),
                )
                .exists()
            )
            statement = statement.where(
                or_(
                    Payments.external_id.ilike(pattern),
                    attendee_match,
                )
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        validated_sort = sort_by if sort_by in self.SORT_FIELDS else "created_at"
        statement = self._apply_sorting(statement, validated_sort, sort_order)
        statement = statement.offset(skip).limit(limit)
        statement = statement.options(
            selectinload(Payments.products_snapshot).selectinload(  # ty: ignore[invalid-argument-type]
                PaymentProducts.attendee  # ty: ignore[invalid-argument-type]
            ),
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_filter(
        self,
        session: Session,
        filters: PaymentFilter,
        skip: int = 0,
        limit: int = 100,
        sort_by: str | None = None,
        sort_order: str = "desc",
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

        validated_sort = sort_by if sort_by in self.SORT_FIELDS else "created_at"
        statement = self._apply_sorting(statement, validated_sort, sort_order)
        statement = statement.offset(skip).limit(limit)
        statement = statement.options(
            selectinload(Payments.products_snapshot).selectinload(  # ty: ignore[invalid-argument-type]
                PaymentProducts.attendee  # ty: ignore[invalid-argument-type]
            ),
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
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
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

    def _decrement_shared_tier_stocks(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
    ) -> None:
        """Atomically decrement shared_stock_remaining for any tier groups
        that own the requested products.

        Aggregates quantities per tier group, then issues one atomic UPDATE
        per group via `tier_groups_crud.decrement_shared_stock`. If any group
        has exhausted its shared cap, the method raises HTTP 409 and the
        caller's transaction must roll back.

        No-op for requests that touch no tier-managed products or only groups
        without a shared cap.
        """
        from app.api.product.crud import tier_groups_crud
        from app.api.product.models import TicketTierGroup, TicketTierPhase

        product_ids = {p.product_id for p in requested_products}
        if not product_ids:
            return

        phases_statement = select(TicketTierPhase).where(
            TicketTierPhase.product_id.in_(product_ids)  # type: ignore[attr-defined]
        )
        phases = list(session.exec(phases_statement).all())
        if not phases:
            return

        product_to_group: dict[uuid.UUID, uuid.UUID] = {
            ph.product_id: ph.group_id for ph in phases
        }

        group_quantities: dict[uuid.UUID, int] = {}
        for rp in requested_products:
            group_id = product_to_group.get(rp.product_id)
            if group_id is not None:
                group_quantities[group_id] = (
                    group_quantities.get(group_id, 0) + rp.quantity
                )

        if not group_quantities:
            return

        group_ids = list(group_quantities.keys())
        groups_statement = select(TicketTierGroup).where(
            TicketTierGroup.id.in_(group_ids),  # type: ignore[attr-defined]
            TicketTierGroup.shared_stock_remaining.is_not(None),  # type: ignore[union-attr]
        )
        groups_with_cap = list(session.exec(groups_statement).all())

        for group in groups_with_cap:
            qty = group_quantities[group.id]
            tier_groups_crud.decrement_shared_stock(session, group.id, qty)

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
        popup: "Popups | None" = None,
    ) -> Decimal:
        """Calculate insurance amount using popup.insurance_percentage and product.insurance_eligible.

        Uses popup-level insurance settings (POPUP-6). Falls back to zero if popup is not provided
        or popup insurance is disabled. The legacy per-product insurance_percentage field is no
        longer read from this path.
        """
        if popup is None:
            return Decimal("0")

        product_ids = list({rp.product_id for rp in requested_products})
        statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
        )
        product_models = {p.id: p for p in session.exec(statement).all()}

        product_quantity_pairs = [
            (product_models[rp.product_id], rp.quantity)
            for rp in requested_products
            if rp.product_id in product_models
        ]
        return calculate_insurance_amount(popup, product_quantity_pairs)

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
            currency=application.popup.currency if application.popup else "USD",
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

        # Calculate insurance if requested (application-flow only — POPUP-6)
        if obj.insurance:
            popup = application.popup if application else None
            insurance_amount = self._calculate_insurance(session, obj.products, popup)
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
        application = self._get_application_with_products(
            session,
            _require_application_id(obj.application_id),
        )
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

        # Reserve shared tier-group stock atomically before taking any
        # irreversible action (creating payment rows, calling SimpleFI). If a
        # linked group is sold out the 409 propagates and the transaction
        # rolls back cleanly.
        self._decrement_shared_tier_stocks(session, obj.products)

        # Use eager loading to avoid N+1 when accessing application relationships
        application = self._get_application_with_products(
            session,
            _require_application_id(obj.application_id),
        )
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        # Handle zero or negative amount (credit covers cost)
        if preview.amount <= 0:
            if preview.amount < 0:
                # Store remaining credit
                application.credit = -preview.amount
                preview.amount = Decimal("0")
            else:
                application.credit = Decimal("0")

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
            prod_statement = select(Products).where(
                Products.id.in_(product_ids),  # type: ignore[attr-defined]
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
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
                        product_currency=preview.currency,
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
        statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
        )
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

            logger.info(
                "Creating SimpleFI pass payment: application_id={} popup_id={} tenant_id={} amount={} currency={} product_count={} coupon_code={} edit_passes={} insurance={}",
                application.id,
                application.popup_id,
                application.tenant_id,
                preview.amount,
                preview.currency,
                len(obj.products),
                obj.coupon_code,
                obj.edit_passes,
                obj.insurance,
            )
            simplefi_response = simplefi_client.create_payment(
                amount=preview.amount,
                popup_slug=application.popup.slug,
                tenant_slug=application.popup.tenant.slug,
                currency=preview.currency,
                reference=reference,
                memo=application.popup.tenant.name,
                portal_base_override=get_portal_url(application.popup.tenant),
            )
            logger.info(
                "SimpleFI pass payment created: application_id={} external_id={} provider_status={} checkout_url={}",
                application.id,
                simplefi_response.id,
                simplefi_response.status,
                simplefi_response.checkout_url,
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
                    product_currency=preview.currency,
                )
                session.add(payment_product)

        # Increment coupon usage if used
        if preview.coupon_id:
            coupons_crud.use_coupon(session, preview.coupon_id)

        session.commit()
        session.refresh(payment)

        logger.info(
            "Pass payment persisted: payment_id={} application_id={} external_id={} status={} amount={} product_count={}",
            payment.id,
            payment.application_id,
            payment.external_id,
            payment.status,
            payment.amount,
            len(obj.products),
        )

        # Update preview with SimpleFI response data
        preview.status = simplefi_response.status
        preview.external_id = simplefi_response.id
        preview.checkout_url = simplefi_response.checkout_url

        return payment, preview

    def approve_payment(
        self,
        session: Session,
        payment_id: uuid.UUID,
        *,
        settlement_currency: str | None = None,
        rate: Decimal | None = None,
        source: str | None = None,
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
            # Set payment fields directly (no intermediate commit)
            payment.status = PaymentStatus.APPROVED.value
            if not payment.currency:
                payment.currency = "USD"
            payment.settlement_currency = (
                settlement_currency or payment.settlement_currency
            )
            if rate is not None:
                payment.rate = rate
            if source is not None:
                payment.source = source
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
        """Create an ambassador group when a payment with a patreon product is approved.

        Returns the created group, or None if no patreon product was purchased or the
        human already has an ambassador group for this popup.
        """
        from app.api.group.crud import groups_crud
        from app.api.product.schemas import CATEGORY_PATREON

        has_patreon_product = any(
            ps.product_category == CATEGORY_PATREON for ps in payment.products_snapshot
        )
        if not has_patreon_product:
            return None

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
