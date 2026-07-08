import uuid
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from loguru import logger
from sqlalchemy import desc, or_, text
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.audit_log.actor import AuditActor, actor_from_system
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.crud import audit_logs_crud
from app.api.human.models import Humans

if TYPE_CHECKING:
    from app.api.checkout.schemas import OpenTicketingPurchaseCreate
    from app.api.group.models import Groups
    from app.api.human.models import Humans
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants
from app.api.application.schemas import ApplicationStatus, ScholarshipStatus
from app.api.attendee.crud import attendees_crud, generate_check_in_code
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
from app.api.product.product_state import ProductSaleState, derive_product_state
from app.api.product.schemas import ProductPublic
from app.api.shared.crud import BaseCRUD
from app.utils.checkout_signing import (
    build_signed_redirect_url,
    build_thank_you_payload,
    build_unsigned_redirect_url,
    verify_cart_restore_token,
)

# Decimal precision for money calculations
MONEY_PRECISION = Decimal("0.01")


def adjust_application_credit(
    session: Session,
    application: Applications,
    delta: Decimal,
    *,
    kind: str,
    source: str,
    actor: AuditActor,
    payment: "Payments | None" = None,
    note: str | None = None,
) -> Decimal:
    """Single mutation point for application.credit.

    Atomically applies the signed delta to the application's credit balance
    AND stages one audit_logs entry in the same transaction (no commit —
    mirrors audit_logs_crud.record contract; caller owns the commit).

    Rules:
    - delta > 0: grant or restore (increases balance)
    - delta < 0: debit (decreases balance; raises ValueError if result < 0)
    - delta == 0: no-op (no write, no audit entry)

    Returns the new balance.
    """
    current = Decimal(str(application.credit)) if application.credit else Decimal("0")
    new = current + delta

    if delta == Decimal("0"):
        return current

    if new < Decimal("0"):
        raise ValueError(
            f"Credit debit of {delta} would drive balance negative "
            f"(current={current}). Debit must not exceed the available balance."
        )

    application.credit = new
    session.add(application)

    # Resolve the human label for the audit entry.
    human_label: str | None = None
    if application.human_id:
        human = session.get(Humans, application.human_id)
        if human is not None:
            first = getattr(human, "first_name", None) or ""
            last = getattr(human, "last_name", None) or ""
            human_label = f"{first} {last}".strip() or getattr(human, "email", None)

    details: dict[str, Any] = {
        "application_id": str(application.id),
        "amount": str(delta),
        "balance_after": str(new),
        "source": source,
        "payment_id": str(payment.id) if payment else None,
        "note": note,
    }

    audit_logs_crud.record(
        session,
        tenant_id=application.tenant_id,
        actor=actor,
        action=kind,
        entity_type=AuditEntityType.HUMAN,
        entity_id=application.human_id,
        entity_label=human_label,
        popup_id=application.popup_id,
        details=details,
    )

    return new


def _build_purchase_thank_you_payload(
    popup: "Popups",
    payment: Payments,
    obj: "OpenTicketingPurchaseCreate",
    products_map: "dict[uuid.UUID, Products]",
    *,
    issued_at: str,
    exp: int,
) -> dict:
    """Order snapshot at creation time — quoted total and items, no provider
    choices (installment count / payment method are chosen later on SimpleFi)."""
    items = [
        {
            "title": products_map[line.product_id].name,
            "qty": line.quantity,
            "price": float(products_map[line.product_id].price),
        }
        for line in obj.products
    ]
    return build_thank_you_payload(
        order_id=str(payment.id),
        first_name=obj.buyer.first_name,
        email=obj.buyer.email,
        items=items,
        amount_total=float(payment.amount),
        currency=popup.currency,
        issued_at=issued_at,
        exp=exp,
    )


def _resolve_open_checkout_success_url(
    popup: "Popups", internal_thank_you_url: str, payload: dict, *, locale: str
) -> str:
    """Resolve where a successful open-checkout buyer lands.

    A custom popup success URL overrides the portal thank-you: signed with the
    order payload when a signing secret is set (external page verifies it),
    plain otherwise. A ``{locale}`` placeholder in the custom URL is replaced
    with the checkout language (e.g. ``.../{locale}/gracias`` → ``.../es/gracias``).
    With no custom URL, the buyer stays on the portal thank-you, which carries
    the order data unsigned so it can render the summary (our own page — no HMAC
    needed).
    """
    custom = popup.open_checkout_success_url
    if custom:
        custom = custom.replace("{locale}", locale)
        secret = popup.open_checkout_signing_secret
        return build_signed_redirect_url(custom, payload, secret) if secret else custom
    return build_unsigned_redirect_url(internal_thank_you_url, payload)


def _internal_open_checkout_thank_you_url(
    portal_base: str, landing_is_checkout: bool, popup: "Popups", payment: Payments
) -> str:
    """Portal thank-you URL for the open-checkout flow (landing-mode aware)."""
    if landing_is_checkout:
        return f"{portal_base}/thank-you?payment_id={payment.id}"
    return f"{portal_base}/checkout/{popup.slug}/thank-you?payment_id={payment.id}"


def resolve_patron_template_config(
    session: Session, popup_id: uuid.UUID
) -> dict | None:
    """Return the active patron-preset step's template_config for a popup.

    Returns None only when no enabled patron-preset step exists. A step with a
    NULL or empty template_config is treated as "configured with defaults" and
    returns an empty dict, so callers can validate amounts permissively.

    If somehow multiple steps exist (race before the DB index was enforced),
    picks the one with the lowest order value.
    """
    from app.api.ticketing_step.models import TicketingSteps

    stmt = (
        select(TicketingSteps)
        .where(
            TicketingSteps.popup_id == popup_id,
            TicketingSteps.template == "patron-preset",
            TicketingSteps.is_enabled == True,  # noqa: E712
        )
        .order_by(TicketingSteps.order)
        .limit(1)
    )
    step = session.exec(stmt).first()
    if step is None:
        return None
    return step.template_config or {}


def validate_patron_amount(amount: Decimal, template_config: dict) -> None:
    """Validate a patron donation amount against the step's template_config.

    Raises HTTPException(422) on:
    - amount < template_config["minimum"] when minimum is configured (raw currency units)
    - allow_custom is False and amount not in template_config["presets"]

    Units are raw popup-currency values (e.g. USD 1000 means $1000, not $10).
    A missing `minimum` key means no floor is enforced.
    """
    minimum_raw = template_config.get("minimum")
    if minimum_raw is not None:
        minimum = Decimal(str(minimum_raw))
        if amount < minimum:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"The amount must be at least {minimum}. "
                    "Please enter a valid amount."
                ),
            )

    allow_custom = template_config.get("allow_custom", True)
    if not allow_custom:
        presets = [Decimal(str(p)) for p in template_config.get("presets", [])]
        if amount not in presets:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "The selected amount is not a valid preset option. "
                    "Please choose one of the available amounts."
                ),
            )


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


def calculate_contribution_amount(
    popup: "Any",
    products_subtotal: Decimal,
) -> Decimal:
    """Pure function: compute contribution amount from popup settings + pre-fee subtotal.

    Contribution is MANDATORY when enabled at popup level — there is no buyer opt-in
    flag. Mirrors `calculate_insurance_amount` shape but drops the per-product
    eligibility filter (contribution applies over the full pre-fee order subtotal).

    Args:
        popup: Object with .contribution_enabled (bool) and
            .contribution_percentage (Decimal|None).
        products_subtotal: Pre-fee snapshot of the order amount
            (post-discount, pre-insurance, pre-contribution).

    Returns:
        Contribution amount rounded to 2 decimal places.
        Returns Decimal("0") if contribution is disabled or percentage is None.
    """
    if not popup.contribution_enabled:
        return Decimal("0")
    if popup.contribution_percentage is None:
        return Decimal("0")

    return (products_subtotal * popup.contribution_percentage / 100).quantize(
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


def _account_credit(application: Applications) -> Decimal:
    """Return the application's stored credit balance (always-on, no gate).

    This is the ONLY source of truth for the persisted credit balance.
    It does NOT consult edit_passes_enabled — the balance is always spent when
    non-zero (R-BE-03). Callers guard the debit path with `if credit > 0`.
    """
    return Decimal(str(application.credit)) if application.credit else Decimal("0")


def _edit_giveup_credit(application: Applications, discount_value: Decimal) -> Decimal:
    """Calculate the give-up value of previously purchased week/day passes.

    Called ONLY when edit_passes=True. Each AttendeeProducts row represents
    one ticket (quantity=1). Patron rows are donations — they contribute nothing
    to credit. Month/full passes never convert to give-up credit (you cannot
    upgrade out of a longer duration). Mirrors the portal-side filter in
    useCreditCalculation.

    This is LIVE edit math, not a stored balance. It must NEVER be added to
    _account_credit for a non-edit purchase (that would double-count). The
    surplus (give-up > new cart) converts to persistent balance once at
    settlement in the zero/negative branch via adjust_application_credit.
    """
    total = Decimal("0")
    for attendee in application.attendees:
        for ap in attendee.attendee_products:
            if ap.product.category == "patreon":
                continue
            if ap.product.duration_type not in ("week", "day"):
                continue
            total += ap.product.price

    return _get_discounted_price(total, discount_value)


def _calculate_amounts(
    session: Session,
    requested_products: list[PaymentProductRequest],
) -> tuple[Decimal, Decimal]:
    """
    Calculate standard and non-discountable amounts.

    Buckets:
      - standard: regular discountable products (coupons / group / scholarship
        discounts reduce this side only)
      - non_discountable: products with `discountable=False`, including patreon
        donations (forced via the schema validator). Charged in full, immune to
        any discount.

    Patreon products are a sub-case of non-discountable: their stored `price`
    is 0 and the buyer-chosen donation lives on `unit_price_override`.

    Returns: (standard_amount, non_discountable_amount)
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
                "non_discountable": Decimal("0"),
            }

        if not product_model.discountable:
            # Patreon donations carry their amount on unit_price_override
            # (product.price is always 0 for patreon). All other
            # non-discountable products use the regular price * quantity.
            if product_model.category == "patreon":
                line_amount = req_prod.unit_price_override or Decimal("0")
            else:
                line_amount = product_model.price * quantity
            attendees[attendee_id]["non_discountable"] += line_amount
        else:
            attendees[attendee_id]["standard"] += product_model.price * quantity

    standard_amount = sum((a["standard"] for a in attendees.values()), Decimal("0"))
    non_discountable_amount = sum(
        (a["non_discountable"] for a in attendees.values()), Decimal("0")
    )

    logger.info(
        "Amounts calculated - Standard: {}, NonDiscountable: {}",
        standard_amount,
        non_discountable_amount,
    )

    return standard_amount, non_discountable_amount


def _calculate_price(
    standard_amount: Decimal,
    non_discountable_amount: Decimal,
    discount_value: Decimal,
    application: Applications,
    edit_passes: bool,
) -> tuple[Decimal, Decimal]:
    """Calculate final price with discounts and credits.

    Returns (final_price, credit_applied) where credit_applied is the amount
    consumed from application.credit (the stored balance) for this purchase.

    Credit logic (R-BE-02, R-BE-03):
    - The stored balance (_account_credit) is ALWAYS applied, regardless of
      edit_passes_enabled. Gate removed per spec.
    - The edit give-up (_edit_giveup_credit) is added ONLY when edit_passes=True.
      This is live math, not a stored balance — no double-count.
    """
    # Always-on: apply stored balance.
    credit = _account_credit(application)
    # Edit-only: add give-up value of previously purchased passes.
    if edit_passes:
        credit += _edit_giveup_credit(application, discount_value)

    logger.info("Credit applied: {}", credit)

    discounted_standard = standard_amount
    if standard_amount > 0:
        discounted_standard = _get_discounted_price(standard_amount, discount_value)

    # credit_applied is the full stored balance whenever the positive-amount
    # path is reached. In that path, final = discounted_standard - credit +
    # non_discountable_amount > 0, which means credit < discounted_standard +
    # non_discountable_amount, i.e. the entire stored balance is consumed.
    # Capping at discounted_standard only (the old behaviour) under-reported
    # the consumed amount when non_discountable_amount > 0.
    # The zero/negative branch in create_payment overrides preview.credit_applied
    # itself, so this value is only used on the positive-amount (SimpleFi) path.
    credit_applied = _account_credit(application)  # >= 0 by construction

    discounted_standard = discounted_standard - credit

    return discounted_standard + non_discountable_amount, credit_applied


def _calculate_max_installments(
    deadline: datetime,
    ceiling: int,
    interval: str,
    interval_count: int,
    now: datetime | None = None,
) -> int:
    """Return how many installment cycles fit before ``deadline``.

    Iterates cycle-by-cycle using ``dateutil.relativedelta`` so month/year
    calendar boundaries are computed identically to SimpleFi (cycle N of a
    plan created on the 31st falls on the last day of the target month, etc).
    A naive ``delta.days // 30`` would silently mismatch SimpleFi's schedule.

    Cycle 1 is "today" (plan creation); subsequent cycles are spaced by
    ``interval * interval_count``. Cycles past ``deadline`` are dropped.
    The result is clamped to ``[1, ceiling]``.
    """
    from calendar import monthrange

    from dateutil.relativedelta import relativedelta

    now = now or datetime.now(UTC)
    if deadline <= now or ceiling < 2:
        return 1

    interval_kwarg = {
        "day": "days",
        "week": "weeks",
        "month": "months",
        "year": "years",
    }[interval]

    count = 1  # cycle 1 is plan creation — always fits
    while count < ceiling:
        offset = relativedelta(**{interval_kwarg: count * interval_count})
        candidate = now + offset
        if interval in ("month", "year"):
            # Mirror SimpleFi's billing_day clipping (Feb 30 -> Feb 28/29).
            _, last_day = monthrange(candidate.year, candidate.month)
            candidate = candidate.replace(day=min(now.day, last_day))
        if candidate > deadline:
            break
        count += 1
    return count


class PaymentsCRUD(BaseCRUD[Payments, PaymentCreate, PaymentUpdate]):
    """CRUD operations for Payments."""

    SORT_FIELDS = {"amount", "status", "created_at"}

    def __init__(self) -> None:
        super().__init__(Payments)

    def get_by_external_id(self, session: Session, external_id: str) -> Payments | None:
        """Get a payment by external ID."""
        statement = select(Payments).where(Payments.external_id == external_id)
        return session.exec(statement).first()

    def _get_in_progress_installment_plan(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> Payments | None:
        """Return the application's in-progress installment plan, or None.

        "In-progress" covers two states:
          - PENDING: SimpleFi plan exists, no installment paid yet.
          - APPROVED with installments_paid < installments_total (or total NULL,
            meaning the activated webhook hasn't filled it yet).

        Completed (paid==total), cancelled, rejected, and expired plans are
        treated as finalized and do NOT block subsequent payments.
        """
        statement = select(Payments).where(
            Payments.application_id == application_id,
            Payments.is_installment_plan == True,  # noqa: E712
            Payments.status.in_(  # type: ignore[attr-defined]
                [PaymentStatus.PENDING.value, PaymentStatus.APPROVED.value]
            ),
            or_(
                Payments.installments_total.is_(None),  # type: ignore[attr-defined]
                Payments.installments_paid < Payments.installments_total,  # type: ignore[operator]
            ),
        )
        return session.exec(statement).first()

    def _validate_open_ticketing_form_data(
        self,
        popup: "Popups",
        form_data: dict[str, Any],
    ) -> None:
        """Validate required custom buyer fields. form_data is keyed by raw field name; base fields (email/first_name/last_name) live top-level on BuyerInfo and are validated by Pydantic."""
        required_field_names = {
            field.name
            for section in popup.form_sections
            for field in section.form_fields
            if section.kind == "standard" and field.required
        }

        missing = [
            field_name
            for field_name in required_field_names
            if form_data.get(field_name) in (None, "", [])
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Missing required form fields",
            )

        popup_field_names = {
            field.name
            for section in popup.form_sections
            for field in section.form_fields
            if section.kind == "standard"
        }
        invalid_names = [
            field_name
            for field_name in form_data
            if field_name not in popup_field_names
        ]
        if invalid_names:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Form data contains unknown fields",
            )

    def _build_buyer_snapshot(
        self,
        popup: "Popups",
        form_data: dict[str, Any],
        attribution: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build immutable buyer snapshot JSONB for open ticketing payments.

        ``attribution`` carries the marketing params captured from the checkout
        entry URL (utm_*, fbclid, landing_segment, anonymous_id). Stored under a
        namespaced key so an outbound purchase webhook can read it back later.
        """
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
                        "value": form_data.get(field.name),
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

        snapshot: dict[str, Any] = {
            "schema_version": 1,
            "submitted_at": datetime.now(UTC).isoformat(),
            "sections": sections_snapshot,
        }
        if attribution:
            snapshot["attribution"] = attribution
        return snapshot

    def _finalize_zero_amount_payment(
        self,
        session: Session,
        payment: Payments,
        products: list[PaymentProductRequest],
        *,
        granted_by_user_id: uuid.UUID | None = None,
    ) -> Payments:
        """Auto-approve a $0 payment and materialize tickets, flush-only.

        Used by three flows that all converge on the same write:
        - authenticated application checkout when discounts zero the cart
        - anonymous open-ticketing checkout when a 100% coupon zeroes it
        - admin bulk grant ($0 comps).

        Sets status=APPROVED, optionally records `granted_by_user_id` (admin
        grant only), and INSERTs AttendeeProducts for the given line items.
        Does NOT commit — callers own the transaction boundary so this helper
        can participate in a larger atomic batch (admin grant) or be paired
        with caller-side commit + email dispatch (self-service flows).
        """
        payment.status = PaymentStatus.APPROVED.value
        if granted_by_user_id is not None:
            payment.granted_by_user_id = granted_by_user_id
        self._add_products_to_attendees(session, products, payment_id=payment.id)
        session.flush()
        return payment

    def create_open_ticketing_payment(
        self,
        session: Session,
        obj: "OpenTicketingPurchaseCreate",
        popup: "Popups",
        tenant: "Tenants",
        attribution: dict[str, str | None] | None = None,
    ) -> tuple[Payments, str, str | None]:
        """Create an anonymous open-ticketing payment with per-ticket attendees.

        Returns ``(payment, checkout_url, redirect_url)``. ``checkout_url`` is the
        SimpleFi-hosted payment page (empty for a zero-amount bypass).
        ``redirect_url`` is set only for the zero-amount bypass when the popup
        configures a custom open-checkout success URL — paid flows redirect via
        SimpleFi and return None.
        """
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

        # Reject products outside their sale window. Closes the stale-tab
        # loophole where the UI was rendered before sale_ends_at passed.
        for product in valid_products:
            state = derive_product_state(ProductPublic.model_validate(product))
            if state != ProductSaleState.on_sale:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Product '{product.name}' is not on sale "
                        f"(state: {state.value})"
                    ),
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
        # ADR-2 supersede pre-step + advisory lock: the ENTIRE new machinery
        # (proof gate, supersede, advisory lock, sibling re-check) is gated on
        # SUPERSEDE_PENDING_ENABLED so that setting it to False restores exact
        # pre-PR behavior — sequential same-buyer purchases succeed without any
        # hold on the lock or 409 from the sibling re-check.
        from app.core.config import settings as _settings

        buyer_snapshot = self._build_buyer_snapshot(
            popup,
            obj.buyer.form_data,
            attribution=(
                obj.attribution.model_dump(exclude_none=True)
                if obj.attribution
                else None
            ),
        )
        buyer_name = (
            f"{obj.buyer.first_name} {obj.buyer.last_name}".strip() or obj.buyer.email
        )

        # _got_oc_lock tracks whether the advisory lock was acquired.
        # The post-lock sibling re-check is gated on _got_oc_lock so it only
        # runs inside the valid-proof path (where the lock is held).
        # With transaction-level locks the finally block needs no explicit
        # unlock, but _got_oc_lock is kept for the guard logic.
        _got_oc_lock = False

        if _settings.SUPERSEDE_PENDING_ENABLED:
            # Security gate (Change 1 / security review): supersede of a prior
            # PENDING payment may ONLY run when the request carries a valid cart
            # continuity proof (signed cart id from the abandoned-cart restore
            # flow).  Without proof, an anonymous attacker could cancel any
            # buyer's pending payment by guessing their email.
            #
            # Valid proof: cid+sig HMAC valid for this popup's signing secret
            # AND the referenced cart belongs to this email+popup.
            # Missing/invalid proof + pending payment present → 409
            #   pending_payment_exists (NO SimpleFi call made).
            # Missing/invalid proof + no pending payment → proceed normally.
            _has_proof = self._validate_cart_continuity_proof(
                session, popup, obj.buyer.email, obj.cid, obj.sig
            )

            if _has_proof:
                # Valid continuity proof: cancel any prior PENDING payment
                # BEFORE acquiring the advisory lock and BEFORE reservation.
                # SimpleFi cancel MUST NOT be called while holding any DB lock.
                # supersede commits the hold release so the reservation sees freed holds.
                self.supersede_pending_payments(
                    session,
                    email=obj.buyer.email,
                    popup_id=popup.id,
                )

                # ADR-2 advisory lock: serialize concurrent open-checkout
                # requests for the same email+popup_id.  Prevents duplicate
                # SimpleFi cancel calls (robustness) and is the serialization
                # point for the sibling re-check inside the try block.
                #
                # TRANSACTION-LEVEL lock (pg_try_advisory_xact_lock): released
                # automatically when the surrounding transaction commits or rolls
                # back.  This avoids the connection-pooling hazard of
                # session-level locks where session.commit() can return the
                # connection to the pool before the explicit pg_advisory_unlock
                # in the finally block, leaving the lock held indefinitely.
                # Non-blocking: abort with 409 if another request holds the lock.
                _oc_lock_key = f"{popup.id}:{obj.buyer.email.lower()}"
                _got_oc_lock = session.execute(
                    text("SELECT pg_try_advisory_xact_lock(hashtext(:key)::bigint)"),
                    {"key": _oc_lock_key},
                ).scalar()
                if not _got_oc_lock:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "code": "concurrent_payment_in_progress",
                            "message": (
                                "Another checkout is currently in progress for this email. "
                                "Please wait a moment and try again."
                            ),
                        },
                    )
            else:
                # No valid proof: guard against anonymous requests that would
                # otherwise supersede a legitimate buyer's pending payment.
                # Critical invariant: NO SimpleFi call is made here.
                if (
                    self._find_pending_by_email_popup(
                        session, obj.buyer.email, popup.id
                    )
                    is not None
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail={
                            "code": "pending_payment_exists",
                            "message": (
                                "A payment is already in progress for this email. "
                                "Please complete your existing checkout or wait for it to expire."
                            ),
                        },
                    )
                # No pending payment → proceed to create the new payment normally.

        try:
            if _settings.SUPERSEDE_PENDING_ENABLED and _got_oc_lock:
                # ADR-2 post-lock sibling re-check (under advisory lock, NO
                # SimpleFi call): abort if a concurrent request already created
                # a new PENDING payment for the same email+popup_id between the
                # supersede step and this lock acquisition.  Only runs on the
                # valid-proof path (where _got_oc_lock is True) — skipped when
                # the no-proof path is taken or SUPERSEDE_PENDING_ENABLED=False.
                self._check_no_pending_sibling_by_email_popup(
                    session, obj.buyer.email, popup.id
                )

            # Validate per-order caps (cheap in-memory check, fail fast before DB).
            self._validate_max_per_order(fabricated_requests, valid_products)
            # Atomically decrement total-stock counters (409 if sold out).
            self._decrement_total_stocks(session, fabricated_requests, valid_products)

            # Store buyer email (lowercase) in snapshot for supersede JSONB lookup
            # on future payment attempts by the same buyer.
            buyer_snapshot["buyer_email"] = obj.buyer.email.lower()

            payment = Payments(
                tenant_id=tenant.id,
                application_id=None,
                popup_id=popup.id,
                status=PaymentStatus.PENDING.value,
                amount=Decimal("0"),
                currency=popup.currency,
                source=PaymentSource.SIMPLEFI.value,
                buyer_snapshot=buyer_snapshot,
                meta_fbc=(attribution or {}).get("fbc"),
                meta_fbp=(attribution or {}).get("fbp"),
                meta_client_ip=(attribution or {}).get("client_ip"),
                meta_client_user_agent=(attribution or {}).get("client_user_agent"),
            )
            session.add(payment)
            session.flush()

            # One attendee per (human, popup) for direct sales — Design §2.1
            attendee = attendees_crud.find_or_create_direct_attendee(
                session,
                human_id=buyer.id,
                popup_id=popup.id,
                tenant_id=tenant.id,
                name=buyer_name,
                email=obj.buyer.email,
            )

            # Split products into discountable vs non-discountable buckets so
            # admin-flagged products (and patreon donations, even though they
            # don't appear in this flow today) bypass any coupon discount.
            discountable_amount = Decimal("0")
            non_discountable_amount = Decimal("0")
            payment_products: list[PaymentProducts] = []
            for line in obj.products:
                product = products_map[line.product_id]
                line_total = product.price * line.quantity
                if product.category == "patreon" or not product.discountable:
                    non_discountable_amount += line_total
                else:
                    discountable_amount += line_total

                for _ in range(line.quantity):
                    # PaymentProducts snapshot only — AttendeeProducts are created
                    # by approve_payment via _add_products_to_attendees when the
                    # webhook confirms the payment. Pre-creating them here caused
                    # duplicates (double the tickets) on every approved checkout.
                    pp = PaymentProducts(
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
                    session.add(pp)
                    payment_products.append(pp)

            discountable_amount = discountable_amount.quantize(
                MONEY_PRECISION, rounding=ROUND_HALF_UP
            )
            non_discountable_amount = non_discountable_amount.quantize(
                MONEY_PRECISION, rounding=ROUND_HALF_UP
            )

            # Skip coupon when there is nothing in the discountable bucket — a
            # coupon would land with zero effect and waste a single-use code.
            # Portal hides the input; this guards crafted requests.
            if obj.coupon_code and discountable_amount > Decimal("0"):
                coupon = coupons_crud.validate_coupon(
                    session, code=obj.coupon_code, popup_id=popup.id
                )
                discount_value = Decimal(str(coupon.discount_value))
                discountable_amount = _get_discounted_price(
                    discountable_amount, discount_value
                )
                payment.coupon_id = coupon.id
                payment.coupon_code = coupon.code
                payment.discount_value = discount_value
                # Consumption is deferred until the payment is persisted (the
                # zero-amount commit or the post-SimpleFi commit below) so a
                # provider failure never burns a single-use code. Mirrors the
                # application flow.

            # Post-discount subtotal is the shared base for BOTH optional fees.
            # Insurance and contribution each read this same baseline so they
            # never compound on each other (mirrors _apply_discounts / ADR-2).
            post_discount_amount = discountable_amount + non_discountable_amount
            payment.amount = post_discount_amount

            # Insurance fee (buyer opt-in). Computed on the eligible-product
            # subtotal at full price via the shared helper, matching the
            # authenticated flow and the portal display. Skipped when the cart
            # is already $0 (a fee on nothing makes no sense).
            if obj.insurance and post_discount_amount > Decimal("0"):
                insurance_amount = calculate_insurance_amount(
                    popup,
                    [
                        (products_map[line.product_id], line.quantity)
                        for line in obj.products
                    ],
                )
                payment.insurance_amount = insurance_amount
                payment.amount += insurance_amount

            # Contribution fee (mandatory when the popup enables it — no buyer
            # opt-in). Its base is the post-discount subtotal, NOT the
            # insurance-inflated total, so the two fees stay independent.
            # Mirrors the application flow in _apply_discounts.
            if popup.contribution_enabled and popup.contribution_percentage:
                contribution_amount = calculate_contribution_amount(
                    popup, post_discount_amount
                )
                payment.contribution_amount = contribution_amount
                payment.amount += contribution_amount

            # Resolve the open-checkout success redirect once, reused by the
            # zero-amount bypass (returned as redirect_url) and the paid path
            # (handed to SimpleFi as the success URL). Snapshot the order now so
            # both the external (signed) and portal (unsigned) thank-you pages
            # can render it. URL construction is landing-mode aware: when
            # landing_mode=checkout the custom domain IS the checkout (no slug).
            from app.api.shared.enums import LandingMode  # noqa: PLC0415

            portal_base = get_portal_url(tenant)
            landing_is_checkout = tenant.landing_mode == LandingMode.checkout
            now = datetime.now(UTC)
            thank_you_payload = _build_purchase_thank_you_payload(
                popup,
                payment,
                obj,
                products_map,
                issued_at=now.isoformat(),
                exp=int(now.timestamp()) + 30 * 60,
            )
            success_redirect = _resolve_open_checkout_success_url(
                popup,
                _internal_open_checkout_thank_you_url(
                    portal_base, landing_is_checkout, popup, payment
                ),
                thank_you_payload,
                locale=obj.locale or popup.default_language or "en",
            )

            # Zero-amount short-circuit: a 100% coupon zeroed the cart, so
            # SimpleFI has nothing to charge and would either reject or auto-
            # approve without firing the webhook. Share the auto-approval path
            # with the authenticated flow so both stay in lock-step (without
            # this, the open-ticketing buyer never received tickets nor the
            # confirmation email).
            if payment.amount == Decimal("0"):
                # A 100% coupon zeroed the cart: consume it now, alongside the
                # auto-approval, since this branch never reaches SimpleFi.
                if payment.coupon_id:
                    coupons_crud.use_coupon(session, payment.coupon_id)
                self._finalize_zero_amount_payment(
                    session,
                    payment,
                    [
                        PaymentProductRequest(
                            product_id=pp.product_id,
                            attendee_id=pp.attendee_id,
                            quantity=pp.quantity,
                        )
                        for pp in payment_products
                    ],
                )
                # Helper is flush-only — own the commit here so the router
                # can fire the confirmation email against the persisted row.
                session.commit()
                session.refresh(payment)
                # No SimpleFi checkout exists for a zero-amount purchase, so we
                # perform the success redirect ourselves: the resolved URL is the
                # custom page (signed when configured) or the portal thank-you
                # carrying the order data. The portal redirects the buyer there.
                return payment, "", success_redirect

            if not popup.simplefi_api_key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Payment provider not configured for this popup",
                )

            simplefi_client = get_simplefi_client(popup.simplefi_api_key)

            # SimpleFi performs the redirect, so hand it the resolved success URL
            # (custom-signed, or the portal thank-you with the order data). The
            # cancel URL stays the landing-aware portal page unless the popup
            # overrides it. Application fee / pass purchase are untouched.
            success_url = success_redirect
            if landing_is_checkout:
                cancel_url = f"{portal_base}/?cancelled=1"
            else:
                cancel_url = f"{portal_base}/checkout/{popup.slug}?cancelled=1"
            if popup.open_checkout_cancel_url:
                cancel_url = popup.open_checkout_cancel_url
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

            # Same installment-plan eligibility as the pass-purchase path —
            # open-ticketing buyers are anonymous but provide an email, which
            # is all SimpleFi needs to create a plan.
            max_installments: int | None = None
            if (
                popup.installments_enabled
                and popup.installments_deadline is not None
                and popup.installments_max is not None
            ):
                computed = _calculate_max_installments(
                    popup.installments_deadline,
                    popup.installments_max,
                    popup.installments_interval,
                    popup.installments_interval_count,
                )
                if computed >= 2:
                    max_installments = computed

            # W3/S3 invariant: SimpleFi CREATE stays inside the advisory lock.
            # Releasing the lock before create_payment would re-open the
            # duplicate-PENDING window: a second request could pass the sibling
            # re-check (finding no PENDING yet) and race to create a second
            # SimpleFi link for the same buyer.
            # The transaction-level advisory lock (pg_try_advisory_xact_lock) is
            # held for the entire current transaction.  session.commit() below
            # commits the new payment row AND atomically releases the lock — so
            # any subsequent lock holder is guaranteed to find the committed row
            # in the sibling re-check.  No explicit unlock is needed.
            simplefi_response = simplefi_client.create_payment(
                amount=payment.amount,
                popup_slug=popup.slug,
                tenant_slug=tenant.slug,
                currency=popup.currency,
                reference=reference,
                memo=f"{popup.name} — open ticketing",
                portal_base_override=portal_base,
                success_path=success_url,
                cancel_path=cancel_url,
                max_installments=max_installments,
                installment_interval=popup.installments_interval,
                installment_interval_count=popup.installments_interval_count,
                user_email=buyer.email,
                plan_name=popup.name,
            )

            payment.external_id = simplefi_response.id
            payment.status = simplefi_response.status
            payment.checkout_url = simplefi_response.checkout_url
            # When the response signals an installment plan, external_id is an
            # installment_plan_id and installments_total stays NULL until the
            # installment_plan_activated webhook delivers the buyer's pick.
            payment.is_installment_plan = simplefi_response.is_installment_plan
            payment.installments_paid = (
                0 if simplefi_response.is_installment_plan else None
            )
            session.add(payment)
            # Consume the coupon only now that SimpleFi accepted the payment, so
            # a provider failure above never burns a single-use code.
            if payment.coupon_id:
                coupons_crud.use_coupon(session, payment.coupon_id)
            session.commit()
            session.refresh(payment)
            # Paid flow: SimpleFi performs the success redirect itself (to the
            # signed success_url built above), so redirect_url is None.
            return payment, simplefi_response.checkout_url, None
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
        finally:
            # Transaction-level advisory lock (pg_try_advisory_xact_lock) is
            # released automatically on commit or rollback — no explicit unlock
            # needed here.  The finally block is kept as documentation that this
            # is intentionally a no-op for the lock: the commit at the end of
            # the try block (or the rollback in the except blocks) handles it.
            pass

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
            selectinload(Payments.products_snapshot)  # ty: ignore[invalid-argument-type]
            .selectinload(PaymentProducts.attendee)  # ty: ignore[invalid-argument-type]
            .selectinload(Attendees.human),  # ty: ignore[invalid-argument-type]
            selectinload(Payments.application).selectinload(  # ty: ignore[invalid-argument-type]
                Applications.human  # ty: ignore[invalid-argument-type]
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
            selectinload(Payments.products_snapshot)  # ty: ignore[invalid-argument-type]
            .selectinload(PaymentProducts.attendee)  # ty: ignore[invalid-argument-type]
            .selectinload(Attendees.human),  # ty: ignore[invalid-argument-type]
            selectinload(Payments.application).selectinload(  # ty: ignore[invalid-argument-type]
                Applications.human  # ty: ignore[invalid-argument-type]
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

        # Reject products outside their sale window. The portal renders the
        # cart client-side, so this is the authoritative gate that closes the
        # stale-tab loophole — and it enforces precise cutoffs such as
        # meal-plan order deadlines (``sale_ends_at`` carries a full datetime).
        # Only the time window is checked here; ``sold_out`` is left to the
        # atomic stock decrement downstream (which raises 409), preserving the
        # existing out-of-stock contract.
        for product in valid_products:
            state = derive_product_state(product)
            if state in (ProductSaleState.ended, ProductSaleState.upcoming):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Product '{product.name}' is not on sale "
                        f"(state: {state.value})"
                    ),
                )

        return valid_products

    def _validate_max_per_order(
        self,
        requested_products: list[PaymentProductRequest],
        valid_products: list[Products],
    ) -> None:
        """Validate that no line item exceeds the product's max_per_order cap.

        Pure in-memory check — no DB access. Raises HTTP 422 on violation.
        Called BEFORE any stock decrement so the failure is cheap and clean.
        """
        products_map = {p.id: p for p in valid_products}
        for req in requested_products:
            product = products_map.get(req.product_id)
            if product is None:
                continue
            if (
                product.max_per_order is not None
                and req.quantity > product.max_per_order
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Quantity {req.quantity} exceeds max_per_order "
                        f"({product.max_per_order}) for '{product.name}'"
                    ),
                )

    def _decrement_total_stocks(
        self,
        session: Session,
        requested_products: list[PaymentProductRequest],
        valid_products: list[Products],
    ) -> None:
        """Atomically decrement total_stock_remaining for each requested product.

        Aggregates quantities per product (multiple line items for the same product
        are summed), then issues one atomic UPDATE per product via
        `products_crud.decrement_total_stock`. No-op for products with NULL cap
        (unlimited). Raises HTTP 409 if any product is sold out.

        Caller's transaction rolls back on any exception.
        """
        from app.api.product.crud import products_crud

        products_map = {p.id: p for p in valid_products}

        # Aggregate quantities per product
        qty_map: dict[uuid.UUID, int] = {}
        for req in requested_products:
            if req.product_id in products_map:
                qty_map[req.product_id] = qty_map.get(req.product_id, 0) + req.quantity

        for product_id, qty in qty_map.items():
            products_crud.decrement_total_stock(session, product_id, qty)

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

        standard_amount, non_discountable_amount = _calculate_amounts(
            session,
            obj.products,
        )

        response.original_amount = standard_amount + non_discountable_amount
        response.amount, response.credit_applied = _calculate_price(
            standard_amount=standard_amount,
            non_discountable_amount=non_discountable_amount,
            discount_value=discount_assigned,
            application=application,
            edit_passes=obj.edit_passes,
        )

        # Check group discount
        if application.group:
            response.group_id = application.group.id
            group_discount = application.group.discount_percentage or Decimal("0")
            discounted_amount, discounted_credit_applied = _calculate_price(
                standard_amount=standard_amount,
                non_discountable_amount=non_discountable_amount,
                discount_value=group_discount,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount < response.amount:
                response.amount = discounted_amount
                response.credit_applied = discounted_credit_applied
                response.discount_value = group_discount

        # Check coupon code. Skip when there is nothing discountable in the
        # cart — applying a coupon would be a no-op and risks burning a
        # single-use coupon for the buyer. Portal hides the input; this guards
        # crafted requests.
        if obj.coupon_code and standard_amount > Decimal("0"):
            coupon = coupons_crud.validate_coupon(
                session,
                code=obj.coupon_code,
                popup_id=application.popup_id,
            )
            coupon_discount = Decimal(str(coupon.discount_value))
            discounted_amount, discounted_credit_applied = _calculate_price(
                standard_amount=standard_amount,
                non_discountable_amount=non_discountable_amount,
                discount_value=coupon_discount,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount < response.amount:
                response.amount = discounted_amount
                response.credit_applied = discounted_credit_applied
                response.coupon_id = coupon.id
                response.coupon_code = coupon.code
                response.discount_value = coupon_discount

        # Check scholarship discount (third competitor — best-of-three)
        if (
            application.scholarship_status == ScholarshipStatus.APPROVED.value
            and application.discount_percentage
        ):
            scholarship_discount_pct = Decimal(str(application.discount_percentage))
            discounted_amount, discounted_credit_applied = _calculate_price(
                standard_amount=standard_amount,
                non_discountable_amount=non_discountable_amount,
                discount_value=scholarship_discount_pct,
                application=application,
                edit_passes=obj.edit_passes,
            )
            if discounted_amount <= response.amount:
                response.amount = discounted_amount
                response.credit_applied = discounted_credit_applied
                response.discount_value = scholarship_discount_pct
                response.coupon_id = None
                response.coupon_code = None
                response.group_id = None
                response.scholarship_discount = True

        # Capture pre-fee snapshot BEFORE any fees are added.
        # Both insurance and contribution must read from the same pre-fee baseline
        # so neither fee compounds the other (see design ADR-2).
        pre_fee_amount = response.amount

        # Calculate insurance if requested (application-flow only — POPUP-6).
        # If discounts dropped the order to $0, there is nothing left to insure,
        # so skip the calc even when the toggle was persisted as true.
        if obj.insurance and pre_fee_amount > Decimal("0"):
            popup = application.popup if application else None
            insurance_amount = self._calculate_insurance(session, obj.products, popup)
            response.insurance_amount = insurance_amount
            response.amount += insurance_amount

        # Calculate contribution fee (mandatory when popup enables it — no buyer opt-in).
        # Uses the pre-fee snapshot so contribution base does not include insurance.
        popup = application.popup if application else None
        if popup and popup.contribution_enabled and popup.contribution_percentage:
            contribution_amount = calculate_contribution_amount(popup, pre_fee_amount)
            response.contribution_amount = contribution_amount
            response.amount += contribution_amount

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
        self._validate_products(session, obj.products, application)
        self._validate_attendees(session, obj.products, application)

        return self._apply_discounts(session, obj, application)

    def _find_recent_duplicate_payment(
        self,
        session: Session,
        application_id: uuid.UUID,
        obj: PaymentCreate,
        preview: PaymentPreview,
    ) -> Payments | None:
        """Return a recently-approved payment whose products and amount match
        the incoming request, or None.

        Used as an idempotency guard against double-submits, bfcache restores,
        and browser/network retries that re-fire an already-processed checkout.
        A legitimate second purchase by the same buyer (different products or
        outside the window) is left alone.
        """
        window_start = datetime.now(tz=UTC) - timedelta(
            seconds=self._DUPLICATE_WINDOW_SECONDS
        )

        incoming_fingerprint = sorted(
            (p.product_id, p.attendee_id, p.quantity) for p in obj.products
        )

        candidates = list(
            session.exec(
                select(Payments)
                .where(
                    Payments.application_id == application_id,
                    Payments.status == PaymentStatus.APPROVED.value,
                    Payments.created_at >= window_start,
                    Payments.amount == preview.amount,
                )
                .options(selectinload(Payments.products_snapshot))  # type: ignore[arg-type]
                .order_by(desc(Payments.created_at))
            ).all()
        )

        for candidate in candidates:
            snapshot = sorted(
                (pp.product_id, pp.attendee_id, pp.quantity)
                for pp in candidate.products_snapshot
            )
            if snapshot == incoming_fingerprint:
                return candidate

        return None

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

    # Idempotency window for duplicate-submit detection. Anything outside
    # this window is treated as a legitimate new purchase intent.
    _DUPLICATE_WINDOW_SECONDS = 300

    def create_payment(
        self,
        session: Session,
        obj: PaymentCreate,
        attribution: dict[str, str | None] | None = None,
        actor: AuditActor | None = None,
    ) -> tuple[Payments, PaymentPreview]:
        """
        Create a payment with all validations and discount calculations.

        For zero-amount payments, auto-approves and adds products directly.
        For paid payments, returns payment with checkout info from SimpleFI.

        Concurrent submissions for the same application are serialized via
        a row-level lock, and a request matching a recently-approved payment
        is short-circuited to that existing payment.

        ``actor`` is the AuditActor for the edit-passes audit event. When
        called from the portal, pass ``actor_from_human(current_human)`` so
        the passes.edited row carries the correct source and identity. When
        omitted (e.g. in background flows or tests that do not have a portal
        user), the system actor is used as the fallback.
        """
        application_id = _require_application_id(obj.application_id)

        # ADR-2 supersede pre-step: cancel any prior PENDING SimpleFi payment
        # for this application BEFORE acquiring the application row lock and
        # BEFORE any new-payment reservation.  The SimpleFi cancel HTTP call
        # MUST NOT be made while holding a DB lock.  supersede_pending_payments
        # commits the hold release (PENDING → CANCELLED) before returning so
        # the subsequent reservation always sees freed coupon/stock/credit.
        from app.core.config import settings as _settings

        if _settings.SUPERSEDE_PENDING_ENABLED:
            self.supersede_pending_payments(session, application_id=application_id)

        # Serialize concurrent payment attempts for the same application.
        # Without this, double-submits and browser retries can produce
        # duplicate Payments + AttendeeProducts (see PR #182 follow-up).
        session.execute(
            text("SELECT id FROM applications WHERE id = :id FOR UPDATE"),
            {"id": application_id},
        )

        # ADR-2 post-lock sibling re-check: abort if a concurrent create_payment
        # call already created a new PENDING payment for the same application
        # between the supersede step above and this lock acquisition.  No
        # SimpleFi call is made under this lock.  Gated on the same flag as
        # supersede to restore pre-PR sequential-purchase behavior when disabled.
        if _settings.SUPERSEDE_PENDING_ENABLED:
            self._check_no_pending_sibling_by_application(session, application_id)

        preview = self.preview_payment(session, obj)

        # Idempotency short-circuit: if we just approved a payment with the
        # same products and amount for this application, return that one
        # instead of creating a duplicate. Stock counters, snapshot rows and
        # ticket inserts have already happened for the original.
        existing = self._find_recent_duplicate_payment(
            session, application_id, obj, preview
        )
        if existing is not None:
            logger.info(
                "Duplicate payment submit short-circuited: "
                "application={} matched existing payment={}",
                application_id,
                existing.id,
            )
            return existing, preview

        # Fetch products once for both validation and decrement helpers.
        product_ids = [p.product_id for p in obj.products]
        products_statement = select(Products).where(
            Products.id.in_(product_ids),  # type: ignore[attr-defined]
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
        )
        valid_products = list(session.exec(products_statement).all())

        # Validate per-order caps (in-memory, fail fast, 422 on violation).
        self._validate_max_per_order(obj.products, valid_products)

        # Validate patron-product rules: quantity=1, unit_price_override required,
        # resolve template_config and validate amount. Raises 422 on any violation.
        # Also rejects unit_price_override on non-patreon products.
        products_map_for_patron = {p.id: p for p in valid_products}
        popup_id_for_patron = valid_products[0].popup_id if valid_products else None
        patron_template_config: dict | None = None  # resolved lazily once
        for req_prod in obj.products:
            product = products_map_for_patron.get(req_prod.product_id)
            if product is None:
                continue
            is_patreon = product.category == "patreon"
            if is_patreon:
                if req_prod.quantity != 1:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Patron products must be purchased one at a time.",
                    )
                if req_prod.unit_price_override is None:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="A donation amount is required for patron products.",
                    )
                if patron_template_config is None and popup_id_for_patron:
                    patron_template_config = resolve_patron_template_config(
                        session, popup_id_for_patron
                    )
                if patron_template_config is None:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=(
                            "This popup has no patron step configured. "
                            "Please set up a patron step before processing patron payments."
                        ),
                    )
                validate_patron_amount(
                    req_prod.unit_price_override, patron_template_config
                )
            else:
                if req_prod.unit_price_override is not None:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="unit_price_override is only allowed for patron products.",
                    )

        # Atomically decrement total-stock counters.
        self._decrement_total_stocks(session, obj.products, valid_products)

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

        # Block edit_passes when an installment plan is in flight on this
        # application. SimpleFi keeps charging the plan independent of our
        # state, so swapping passes would leave attendee products inconsistent
        # with money still being collected. Admin can manually cancel the
        # plan (PATCH status=cancelled) to unblock; completed/cancelled plans
        # don't trip this guard.
        if obj.edit_passes:
            active_plan = self._get_in_progress_installment_plan(
                session, application.id
            )
            if active_plan:
                logger.warning(
                    "Blocked edit_passes for application_id={}: in-progress installment plan payment_id={} (paid={}/{})",
                    application.id,
                    active_plan.id,
                    active_plan.installments_paid,
                    active_plan.installments_total,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "Cannot edit passes while an installment plan is in "
                        "progress. Complete the plan or contact support to "
                        "cancel it."
                    ),
                )

        # Handle zero or negative amount (credit covers cost)
        if preview.amount <= 0:
            current_stored_credit = _account_credit(application)
            # Attribute the movement to the human who triggered it (portal),
            # falling back to system for non-request callers. The source is a
            # give-up only when this is an actual edit; a plain purchase whose
            # stored credit covers the cart must read as "purchase".
            _settlement_actor = actor if actor is not None else actor_from_system()
            _settlement_source = "edit_passes" if obj.edit_passes else "purchase"
            if preview.amount < 0:
                # Surplus case: give-up credit (edit math) exceeded the new cart.
                # The surplus converts to persistent stored balance via the helper.
                # new_balance = -preview.amount (the leftover after covering the cart)
                # delta = new_balance - current_stored_credit (may be positive or negative)
                new_credit_balance = -preview.amount
                credit_delta = new_credit_balance - current_stored_credit
                # credit_applied is how much of the stored balance was consumed
                # (0 if the edit give-up alone covered everything and balance grew)
                credit_consumed = max(
                    Decimal("0"), current_stored_credit - new_credit_balance
                )
                if credit_delta != Decimal("0"):
                    adjust_application_credit(
                        session,
                        application,
                        credit_delta,
                        kind=AuditAction.CREDIT_GRANTED
                        if credit_delta > 0
                        else AuditAction.CREDIT_APPLIED,
                        source=_settlement_source,
                        actor=_settlement_actor,
                    )
                preview.credit_applied = credit_consumed
                preview.amount = Decimal("0")
            else:
                # Exact-zero case: all stored credit was consumed.
                if current_stored_credit > Decimal("0"):
                    adjust_application_credit(
                        session,
                        application,
                        -current_stored_credit,
                        kind=AuditAction.CREDIT_APPLIED,
                        source=_settlement_source,
                        actor=_settlement_actor,
                    )
                preview.credit_applied = current_stored_credit

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

            # Create payment record first so AttendeeProducts can link to it.
            payment = Payments(
                tenant_id=application.tenant_id,
                application_id=obj.application_id,
                popup_id=application.popup_id,
                status=PaymentStatus.APPROVED.value,
                amount=preview.amount,
                insurance_amount=preview.insurance_amount,
                contribution_amount=preview.contribution_amount,
                currency=preview.currency,
                coupon_id=preview.coupon_id,
                coupon_code=preview.coupon_code,
                discount_value=preview.discount_value,
                edit_passes=obj.edit_passes,
                group_id=preview.group_id,
                credit_applied=preview.credit_applied,
                source=None,
                meta_fbc=(attribution or {}).get("fbc"),
                meta_fbp=(attribution or {}).get("fbp"),
                meta_client_ip=(attribution or {}).get("client_ip"),
                meta_client_user_agent=(attribution or {}).get("client_user_agent"),
            )
            session.add(payment)
            session.flush()

            # Emit passes.edited audit event for the edit-passes settlement.
            # Placed here (after flush, payment.id is available) so the row is
            # committed atomically with the payment. One record per settlement —
            # the zero/negative and positive-amount paths are mutually exclusive
            # (zero-branch returns early before the SimpleFi path), so there is
            # no double-fire risk between the two branches.
            if obj.edit_passes:
                _edit_actor = actor if actor is not None else actor_from_system()
                audit_logs_crud.record(
                    session,
                    tenant_id=application.tenant_id,
                    actor=_edit_actor,
                    action=AuditAction.PASSES_EDITED,
                    entity_type=AuditEntityType.HUMAN,
                    entity_id=application.human_id,
                    popup_id=application.popup_id,
                    details={"payment_id": str(payment.id)},
                )

            # Build product snapshots before approval so they're available
            # when AttendeeProducts are materialized in the finalizer.
            product_ids = [p.product_id for p in obj.products]
            prod_statement = select(Products).where(
                Products.id.in_(product_ids),  # type: ignore[attr-defined]
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
            products_map = {p.id: p for p in session.exec(prod_statement).all()}

            for req_prod in obj.products:
                product = products_map.get(req_prod.product_id)
                if product:
                    is_patreon = product.category == "patreon"
                    payment_product = PaymentProducts(
                        tenant_id=application.tenant_id,
                        payment_id=payment.id,
                        product_id=req_prod.product_id,
                        attendee_id=req_prod.attendee_id,
                        quantity=req_prod.quantity,
                        product_name=product.name,
                        product_description=product.description,
                        product_price=Decimal("0") if is_patreon else product.price,
                        product_category=product.category or "",
                        product_currency=preview.currency,
                        effective_unit_price=req_prod.unit_price_override
                        if is_patreon
                        else None,
                        purchase_metadata=req_prod.purchase_metadata,
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

            # Shared finalizer: materializes AttendeeProducts and flushes.
            # Same code path as the anonymous open-ticketing flow and the
            # admin bulk-grant flow so they can't drift again.
            self._finalize_zero_amount_payment(session, payment, obj.products)
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

        # Compute installment-plan eligibility for this payment. Edit-passes
        # deltas are always one-shot (see PR design — Option A); confirmed
        # in-flight plans are blocked by the guard above so we only see fresh
        # purchases here.
        popup = application.popup
        max_installments: int | None = None
        if (
            not obj.edit_passes
            and popup.installments_enabled
            and popup.installments_deadline is not None
            and popup.installments_max is not None
        ):
            computed = _calculate_max_installments(
                popup.installments_deadline,
                popup.installments_max,
                popup.installments_interval,
                popup.installments_interval_count,
            )
            if computed >= 2:
                max_installments = computed

        try:
            from app.api.tenant.utils import get_portal_url

            logger.info(
                "Creating SimpleFI pass payment: application_id={} popup_id={} tenant_id={} amount={} currency={} product_count={} coupon_code={} edit_passes={} insurance={} max_installments={}",
                application.id,
                application.popup_id,
                application.tenant_id,
                preview.amount,
                preview.currency,
                len(obj.products),
                obj.coupon_code,
                obj.edit_passes,
                obj.insurance,
                max_installments,
            )
            simplefi_response = simplefi_client.create_payment(
                amount=preview.amount,
                popup_slug=application.popup.slug,
                tenant_slug=application.popup.tenant.slug,
                currency=preview.currency,
                reference=reference,
                memo=application.popup.tenant.name,
                portal_base_override=get_portal_url(application.popup.tenant),
                max_installments=max_installments,
                installment_interval=popup.installments_interval,
                installment_interval_count=popup.installments_interval_count,
                user_email=application.human.email if application.human else None,
                plan_name=popup.name,
            )
            logger.info(
                "SimpleFI pass payment created: application_id={} external_id={} provider_status={} checkout_url={} is_installment_plan={}",
                application.id,
                simplefi_response.id,
                simplefi_response.status,
                simplefi_response.checkout_url,
                simplefi_response.is_installment_plan,
            )
        except Exception as e:
            logger.error(f"Failed to create SimpleFI payment: {e}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to create payment with payment provider",
            ) from e

        # Create payment record with SimpleFI data. When the response signals
        # an installment plan, external_id is the installment_plan_id (not a
        # payment_request_id) and installments_total stays NULL until the
        # `installment_plan_activated` webhook delivers the buyer's pick.
        payment = Payments(
            tenant_id=application.tenant_id,
            application_id=obj.application_id,
            popup_id=application.popup_id,
            status=simplefi_response.status,
            amount=preview.amount,
            insurance_amount=preview.insurance_amount,
            contribution_amount=preview.contribution_amount,
            currency=preview.currency,
            coupon_id=preview.coupon_id,
            coupon_code=preview.coupon_code,
            discount_value=preview.discount_value,
            edit_passes=obj.edit_passes,
            group_id=preview.group_id,
            external_id=simplefi_response.id,
            checkout_url=simplefi_response.checkout_url,
            source=PaymentSource.SIMPLEFI.value,
            is_installment_plan=simplefi_response.is_installment_plan,
            installments_paid=0 if simplefi_response.is_installment_plan else None,
            # Set credit_applied atomically with row creation so there is no
            # window between INSERT and the separate assignment below where a
            # crash could leave credit debited but the payment row untagged.
            credit_applied=preview.credit_applied,
            meta_fbc=(attribution or {}).get("fbc"),
            meta_fbp=(attribution or {}).get("fbp"),
            meta_client_ip=(attribution or {}).get("client_ip"),
            meta_client_user_agent=(attribution or {}).get("client_user_agent"),
        )

        session.add(payment)
        session.flush()  # Get payment ID

        # Debit the application's credit balance at payment creation (reservation).
        # This must happen after flush so payment.id exists for the audit log.
        # Guard: only when credit was actually consumed (preview.credit_applied > 0).
        if preview.credit_applied > Decimal("0"):
            adjust_application_credit(
                session,
                application,
                -preview.credit_applied,
                kind=AuditAction.CREDIT_APPLIED,
                source="purchase",
                actor=actor if actor is not None else actor_from_system(),
                payment=payment,
            )

        # Emit passes.edited audit event for the edit-passes settlement.
        # Placed here (after flush, payment.id is available) so the row is
        # committed atomically with the PENDING payment creation. The zero/negative
        # branch returns before reaching this point, so one record is emitted
        # exactly once per successful settlement path.
        if obj.edit_passes:
            _edit_actor = actor if actor is not None else actor_from_system()
            audit_logs_crud.record(
                session,
                tenant_id=application.tenant_id,
                actor=_edit_actor,
                action=AuditAction.PASSES_EDITED,
                entity_type=AuditEntityType.HUMAN,
                entity_id=application.human_id,
                popup_id=application.popup_id,
                details={"payment_id": str(payment.id)},
            )

        # Create product snapshots
        for req_prod in obj.products:
            product = products_map.get(req_prod.product_id)
            if product:
                is_patreon = product.category == "patreon"
                payment_product = PaymentProducts(
                    tenant_id=application.tenant_id,
                    payment_id=payment.id,
                    product_id=req_prod.product_id,
                    attendee_id=req_prod.attendee_id,
                    quantity=req_prod.quantity,
                    product_name=product.name,
                    product_description=product.description,
                    product_price=Decimal("0") if is_patreon else product.price,
                    product_category=product.category or "",
                    product_currency=preview.currency,
                    effective_unit_price=req_prod.unit_price_override
                    if is_patreon
                    else None,
                    purchase_metadata=req_prod.purchase_metadata,
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

    def _direct_buyer_email(self, session: Session, payment: Payments) -> str | None:
        """Resolve the buyer email for a direct-sale payment via its attendee.

        Direct-sale payments have no application; the buyer is the human behind
        the (single) attendee on the payment's product snapshot. Used to clear
        the anonymous open-checkout cart keyed by that email.
        """
        snapshot = payment.products_snapshot
        if not snapshot:
            return None
        attendee = session.get(Attendees, snapshot[0].attendee_id)
        if attendee is None or attendee.human is None:
            return None
        return attendee.human.email

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
                    purchase_metadata=pp.purchase_metadata,
                )
                for pp in payment.products_snapshot
            ]
            self._add_products_to_attendees(
                session, products_to_add, payment_id=payment.id
            )

            # Create ambassador group if patreon product was purchased.
            # Direct-sale payments have no application — skip ambassador logic
            # (it requires application.human_id for the group leader).
            if payment.application_id is not None:
                self._create_ambassador_group(session, payment)

            # Clear cart after successful payment. Application flow clears by
            # human; direct-sale (open checkout) clears the anonymous cart by the
            # buyer email so a returning buyer never restores an already-paid cart.
            from app.api.cart.crud import carts_crud

            if payment.application:
                carts_crud.delete_by_human_popup(
                    session,
                    human_id=payment.application.human_id,
                    popup_id=payment.application.popup_id,
                )
            elif payment.popup_id:
                buyer_email = self._direct_buyer_email(session, payment)
                if buyer_email:
                    carts_crud.delete_anonymous_by_email_popup(
                        session, buyer_email, payment.popup_id
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
        """Remove all AttendeeProducts rows linked to this payment.

        Uses payment_id FK for precise removal — avoids deleting tickets that
        belong to a different payment but share the same (attendee, product) pair.
        """
        logger.info("Removing products from attendees for payment {}", payment.id)
        statement = select(AttendeeProducts).where(
            AttendeeProducts.payment_id == payment.id,
        )
        tickets = list(session.exec(statement).all())
        for ticket in tickets:
            session.delete(ticket)

        session.flush()

    def _add_products_to_attendees(
        self,
        session: Session,
        products: list[PaymentProductRequest],
        payment_id: uuid.UUID | None = None,
    ) -> None:
        """Add products to attendees after payment approval.

        Each PaymentProductRequest.quantity creates N new AttendeeProducts rows.
        Always-INSERT — no upsert. Each row is an independent ticket with its own
        UUID and check_in_code.
        """
        if not products:
            return

        first_attendee = session.get(Attendees, products[0].attendee_id)
        if not first_attendee:
            logger.error(f"Attendee not found: {products[0].attendee_id}")
            return

        tenant_id = first_attendee.tenant_id

        for req_prod in products:
            for _ in range(req_prod.quantity):
                attendee_product = AttendeeProducts(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    attendee_id=req_prod.attendee_id,
                    product_id=req_prod.product_id,
                    check_in_code=generate_check_in_code(""),
                    payment_id=payment_id,
                    purchase_metadata=req_prod.purchase_metadata,
                )
                session.add(attendee_product)

        session.flush()

    def _restore_payment_stock(
        self,
        session: Session,
        payment: Payments,
    ) -> None:
        """Restore total_stock_remaining and shared_stock_remaining for every
        product/tier in the payment.

        Source of truth for per-product quantities: payment.products_snapshot
        (PaymentProducts rows keyed by payment_id).  SimpleFI's webhook payload
        carries only the external payment_request.id — no per-product data.
        We look up the local Payments row and iterate its snapshot here.

        Idempotency contract: callers MUST verify that the payment is currently
        in a stock-holding status (PENDING) before calling this method.  The
        LEAST-clamp in restore_total_stock / restore_shared_stock provides a
        structural backstop against double-restore drift past the cap, but the
        status guard prevents the semantic double-count.

        APPROVED → CANCELLED (refund flow) is OUT OF SCOPE: callers must not
        invoke this method when old_status == APPROVED.  That path requires a
        separate refund-stock decision and is intentionally not wired here.
        See design §4.2 and proposal locked decisions.
        """
        from app.api.product.crud import products_crud

        if not payment.products_snapshot:
            return

        for pp in payment.products_snapshot:
            # Restore per-product total stock counter (no-op for unlimited products).
            products_crud.restore_total_stock(session, pp.product_id, pp.quantity)

    # ------------------------------------------------------------------
    # ADR-2 / ADR-3 / ADR-4  — supersede helpers
    # ------------------------------------------------------------------

    def _reconcile_approved(
        self,
        session: Session,
        payment: Payments,
    ) -> Payments:
        """Idempotently approve a payment whose SimpleFi status is already approved.

        Called by supersede_pending_payments (race-lost path) and the pending
        payment sweeper (approved-during-sweep path).  Confirmation email
        dispatch is the caller's responsibility because this method is
        synchronous.

        Acquires a ``SELECT ... FOR UPDATE`` row lock before reading the current
        status so that a concurrent webhook path (which also calls approve_payment
        via update_status) cannot add products a second time.  The lock also
        refreshes the session identity map so approve_payment sees the current
        DB state even when supersede_pending_payments pre-loaded the payment as
        PENDING in the same session.

        Returns the (possibly freshly) approved payment.
        """
        # Lock the row and get a fresh DB read, overriding any stale PENDING
        # value cached in the session identity map from the earlier supersede
        # lookup.  After this query, session.get(Payments, payment.id) returns
        # the refreshed instance, so approve_payment's own idempotency guard
        # sees the current status from the DB.
        fresh = session.exec(
            select(Payments).where(Payments.id == payment.id).with_for_update()
        ).first()
        if fresh is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found",
            )
        if fresh.status == PaymentStatus.APPROVED.value:
            # Already approved by a concurrent transaction (e.g. webhook beat
            # supersede to the lock).  Return without adding products again.
            return fresh
        return self.approve_payment(session, payment.id)

    def _check_no_pending_sibling_by_application(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> None:
        """Post-lock guard (authenticated): abort when a concurrent sibling PENDING payment exists.

        Called AFTER the ``applications FOR UPDATE`` lock is acquired in
        create_payment.  A sibling is any PENDING payment already linked to
        this application_id — meaning a concurrent create_payment call already
        passed the supersede pre-step and started a new payment.  The slower
        caller should abort so there is exactly ONE new PENDING payment per
        application.

        Raises HTTP 409 ``concurrent_payment_in_progress``.  NO SimpleFi call
        is made under this lock (ADR-2 invariant).
        """
        sibling = session.exec(
            select(Payments).where(
                Payments.application_id == application_id,
                Payments.status == PaymentStatus.PENDING.value,  # type: ignore[arg-type]
            )
        ).first()
        if sibling is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "concurrent_payment_in_progress",
                    "message": (
                        "Another payment for this application is currently being "
                        "processed. Please wait a moment and try again."
                    ),
                },
            )

    def _find_pending_by_email_popup(
        self,
        session: Session,
        email: str,
        popup_id: uuid.UUID,
    ) -> Payments | None:
        """Return the first PENDING SimpleFi open-checkout payment for email+popup, or None.

        Used by the continuity-proof gate to check whether a prior PENDING
        payment exists without triggering any SimpleFi calls.  Same query as
        supersede_pending_payments (email path) so they stay in sync.
        """
        return session.exec(
            select(Payments)
            .where(
                Payments.popup_id == popup_id,
                Payments.status == PaymentStatus.PENDING.value,  # type: ignore[arg-type]
                Payments.application_id.is_(None),  # type: ignore[union-attr]
                Payments.source == PaymentSource.SIMPLEFI.value,  # type: ignore[arg-type]
                Payments.external_id.is_not(None),  # type: ignore[union-attr]
            )
            .where(text("buyer_snapshot->>'buyer_email' = :email"))
            .params(email=email.lower())
        ).first()

    def _validate_cart_continuity_proof(
        self,
        session: Session,
        popup: "Popups",
        buyer_email: str,
        cid: uuid.UUID | None,
        sig: str | None,
    ) -> bool:
        """Return True iff cid+sig constitute a valid cart continuity proof for this buyer+popup.

        Reuses verify_cart_restore_token from checkout_signing — the same HMAC
        scheme used by GET /checkout/{slug}/cart?cid=&sig= (cart restore).
        A valid proof requires ALL of:
        1. Both cid and sig are present.
        2. The popup has an open_checkout_signing_secret.
        3. HMAC signature is valid for the given cid and secret.
        4. The referenced cart belongs to this popup (popup_id match built into
           carts_crud.find_anonymous_by_id_popup).
        5. The cart's email matches the buyer email (case-insensitive).

        A valid token for a different email or a different popup is always invalid.
        """
        if cid is None or sig is None:
            return False
        secret = popup.open_checkout_signing_secret
        if not secret:
            return False
        if not verify_cart_restore_token(str(cid), sig, secret):
            return False
        from app.api.cart.crud import carts_crud as _carts_crud  # noqa: PLC0415

        cart = _carts_crud.find_anonymous_by_id_popup(session, cid, popup.id)
        if cart is None:
            return False
        cart_email: str = getattr(cart, "email", None) or ""
        return cart_email.lower() == buyer_email.lower()

    def _check_no_pending_sibling_by_email_popup(
        self,
        session: Session,
        email: str,
        popup_id: uuid.UUID,
    ) -> None:
        """Post-lock guard (open checkout): abort when a concurrent sibling PENDING payment exists.

        Called inside the ``pg_try_advisory_lock`` section in
        create_open_ticketing_payment.  Matches PENDING open-checkout payments
        by the ``buyer_snapshot->>'buyer_email'`` JSONB field (stored as
        lowercase at creation time).

        Raises HTTP 409 ``concurrent_payment_in_progress``.  NO SimpleFi call
        is made under this lock (ADR-2 invariant).
        """
        sibling = session.exec(
            select(Payments)
            .where(
                Payments.popup_id == popup_id,
                Payments.status == PaymentStatus.PENDING.value,  # type: ignore[arg-type]
                Payments.application_id.is_(None),  # type: ignore[union-attr]
            )
            .where(text("buyer_snapshot->>'buyer_email' = :email"))
            .params(email=email.lower())
        ).first()
        if sibling is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "concurrent_payment_in_progress",
                    "message": (
                        "Another checkout is currently in progress for this email. "
                        "Please wait a moment and try again."
                    ),
                },
            )

    def supersede_pending_payments(
        self,
        session: Session,
        *,
        application_id: uuid.UUID | None = None,
        email: str | None = None,
        popup_id: uuid.UUID | None = None,
    ) -> None:
        """Cancel any prior PENDING SimpleFi payment for this buyer before creating a new one.

        ADR-2: Runs as a committed PRE-STEP at the START of create_payment
        (authenticated) and create_open_ticketing_payment (open checkout),
        BEFORE any DB lock is acquired and BEFORE stock/coupon reservation.
        The SimpleFi cancel HTTP call MUST NOT be made while holding any DB
        lock.

        Lookup key:
        - Authenticated: ``application_id`` — finds PENDING payment with
          matching application_id, source=SIMPLEFI, external_id IS NOT NULL.
        - Open checkout: ``email + popup_id`` — finds PENDING open-checkout
          payment with matching ``buyer_snapshot->>'buyer_email'`` and popup_id.

        Outcomes:
        - CANCELED: calls ``update_status(old, CANCELLED)`` which COMMITs the
          release of coupon, stock, and credit holds.  Returns normally.
        - ALREADY_APPROVED: calls ``_reconcile_approved`` (idempotent approve),
          then raises HTTP 409 ``previous_payment_completed``. The detail body
          carries no payment identifiers; for open checkout it includes a
          SIGNED thank-you redirect URL only when the popup has signing
          configured, otherwise no URL at all.
        - Any exception (CancelOutcomeAmbiguousError, transport, 5xx): raises
          HTTP 502 ``payment_cancel_failed``.  Holds are NOT released — never
          release without SimpleFi confirmation.

        If no prior PENDING payment exists, this method is a no-op.

        Args:
            session: Active DB session.  update_status commits on CANCELED path.
            application_id: Lookup key for authenticated checkout.
            email: Buyer email for open-checkout lookup (requires popup_id).
            popup_id: Required when email is provided.
        """
        from app.api.popup.models import Popups as _Popups
        from app.api.tenant.models import Tenants as _Tenants
        from app.api.tenant.utils import get_portal_url
        from app.services.simplefi import get_simplefi_client
        from app.services.simplefi.client import (
            CancelOutcome,
            CancelOutcomeAmbiguousError,
        )

        # Locate the prior PENDING SimpleFi payment for this buyer
        prior: Payments | None = None

        if application_id is not None:
            prior = session.exec(
                select(Payments).where(
                    Payments.application_id == application_id,
                    Payments.status == PaymentStatus.PENDING.value,  # type: ignore[arg-type]
                    Payments.source == PaymentSource.SIMPLEFI.value,  # type: ignore[arg-type]
                    Payments.external_id.is_not(None),  # type: ignore[union-attr]
                )
            ).first()
        elif email is not None and popup_id is not None:
            prior = self._find_pending_by_email_popup(session, email, popup_id)

        if prior is None:
            return  # No prior pending payment — nothing to supersede

        # Resolve the SimpleFi API key from the payment's popup
        _popup = session.get(_Popups, prior.popup_id)
        if _popup is None or not _popup.simplefi_api_key:
            # No API key: the payment was never sent to SimpleFi (orphaned).
            # Release holds anyway since there is no live link to protect.
            logger.warning(
                "supersede_pending_payments: no simplefi_api_key for popup={}, "
                "releasing holds on orphaned payment={}",
                prior.popup_id,
                prior.id,
            )
            self.update_status(session, prior.id, PaymentStatus.CANCELLED)
            return

        simplefi_client = get_simplefi_client(_popup.simplefi_api_key)

        # Call SimpleFi cancel OUTSIDE any DB lock (ADR-2, ADR-3)
        try:
            if prior.is_installment_plan:
                outcome = simplefi_client.cancel_installment_plan(
                    str(prior.external_id)
                )
            else:
                outcome = simplefi_client.cancel_payment_request(str(prior.external_id))
        except CancelOutcomeAmbiguousError as exc:
            # Outcome unresolvable (ambiguous response from SimpleFi) — do NOT
            # release holds.  Distinct log from transport failures so alerts
            # can differentiate provider-side ambiguity from network issues.
            logger.warning(
                "supersede_pending_payments: SimpleFi cancel outcome ambiguous "
                "payment={}, error={!r}",
                prior.id,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "payment_cancel_failed",
                    "message": "We could not process your payment. Please try again.",
                },
            ) from exc
        except Exception as exc:
            # Transport error, timeout, or 5xx — do NOT release holds
            logger.warning(
                "supersede_pending_payments: SimpleFi cancel failed "
                "payment={}, error={!r}",
                prior.id,
                exc,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={
                    "code": "payment_cancel_failed",
                    "message": "We could not process your payment. Please try again.",
                },
            ) from exc

        if outcome == CancelOutcome.CANCELED:
            # Happy path: cancel confirmed — commit the hold release
            self.update_status(session, prior.id, PaymentStatus.CANCELLED)

        elif outcome == CancelOutcome.ALREADY_APPROVED:
            # Race lost: prior payment completed concurrently.
            # Idempotently approve to ensure tickets are issued.
            self._reconcile_approved(session, prior)

            # Build a safe redirect URL for the 409 response.
            # Security contract (S1):
            #   - Never expose the raw payment UUID to anonymous callers.
            #   - Open checkout: return a SIGNED external redirect ONLY when
            #     both a signing secret AND an external success URL are configured.
            #     Any other case omits redirect_url (portal falls back to
            #     message-only).  An unsigned internal portal URL MUST NOT be
            #     returned here — it carries the raw payment UUID in the path.
            #   - Authenticated: redirect to the buyer's own passes page; no
            #     payment UUID is needed or included.
            redirect_url: str | None = None
            _tenant = session.get(_Tenants, prior.tenant_id) if _popup else None

            if (
                prior.application_id is None
                and _popup is not None
                and _tenant is not None
            ):
                # Open-checkout path: signed external redirect only.
                secret = _popup.open_checkout_signing_secret
                if secret and _popup.open_checkout_success_url:
                    payload = build_thank_you_payload(
                        order_id=str(prior.id),
                        first_name=str(
                            (prior.buyer_snapshot or {}).get("first_name", "")
                        ),
                        email=str((prior.buyer_snapshot or {}).get("buyer_email", "")),
                        items=[
                            {"name": pp.product_name, "quantity": pp.quantity}
                            for pp in prior.products_snapshot
                        ],
                        amount_total=str(prior.amount),
                        currency=prior.currency or "",
                        issued_at=datetime.now(UTC).isoformat(),
                    )
                    redirect_url = build_signed_redirect_url(
                        _popup.open_checkout_success_url, payload, secret
                    )
                # else: no signing secret or no external URL — omit redirect_url

            elif (
                prior.application_id is not None
                and _popup is not None
                and _tenant is not None
            ):
                # Authenticated path: send buyer to their own passes page.
                portal_base = get_portal_url(_tenant)
                redirect_url = f"{portal_base}/portal/{_popup.slug}/passes"

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "previous_payment_completed",
                    "message": "Your previous payment was completed.",
                    "redirect_url": redirect_url,
                },
            )

    def update_status(
        self,
        session: Session,
        payment_id: uuid.UUID,
        new_status: PaymentStatus,
    ) -> Payments:
        """Update payment status.

        ADR-1: A ``SELECT ... FOR UPDATE`` row lock is acquired at the top of
        this method to serialize concurrent callers (supersede, SimpleFi
        webhook, sweeper).  The PENDING-only release guard below is therefore
        atomic: only one caller reads PENDING and releases holds; subsequent
        callers find the status already terminal and skip the release.
        """
        # ADR-1: Acquire row lock AND read fresh state in a single query.
        # Using ``with_for_update()`` on the SELECT bypasses the session
        # identity map, ensuring this caller sees the post-lock DB state
        # even when the same session pre-loaded the payment as PENDING
        # (e.g. supersede loads ``prior`` before calling update_status; a
        # concurrent transaction could commit CANCELLED between those two
        # points; the old two-step approach — raw text() lock + self.get() —
        # would return the stale PENDING from the identity map and release
        # holds a second time).
        payment = session.exec(
            select(Payments).where(Payments.id == payment_id).with_for_update()
        ).first()
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Payment not found",
            )

        old_status = payment.status

        # Restore stock when transitioning OUT of PENDING into a terminal non-approved
        # state.  Idempotency guard: only restore when old_status was PENDING.
        # APPROVED → CANCELLED (refund flow) is explicitly OUT OF SCOPE per design
        # §4.2 — no stock restoration in that path (separate future feature).
        if (
            new_status
            in (PaymentStatus.CANCELLED, PaymentStatus.REJECTED, PaymentStatus.EXPIRED)
            and old_status == PaymentStatus.PENDING.value
        ):
            self._restore_payment_stock(session, payment)
            # Release the coupon use held since payment creation. Same guard as
            # stock (PENDING-only) prevents semantic double-release. APPROVED is
            # out of scope: a paid coupon use must stay consumed.
            if payment.coupon_id:
                coupons_crud.release_use(session, payment.coupon_id)
            # Restore the credit balance debited when this payment was created.
            # The PENDING-only guard above ensures idempotency (mirrors coupon/stock).
            credit_to_restore = payment.credit_applied or Decimal("0")
            if credit_to_restore > Decimal("0") and payment.application_id:
                from app.api.application.crud import applications_crud

                application = applications_crud.get(session, payment.application_id)
                if application:
                    adjust_application_credit(
                        session,
                        application,
                        credit_to_restore,
                        kind=AuditAction.CREDIT_RESTORED,
                        source="purchase",
                        actor=actor_from_system(),
                        payment=payment,
                    )

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
                    purchase_metadata=pp.purchase_metadata,
                )
                for pp in payment.products_snapshot
            ]
            self._add_products_to_attendees(
                session, products_to_add, payment_id=payment.id
            )

        session.add(payment)
        session.commit()
        session.refresh(payment)

        return payment


payments_crud = PaymentsCRUD()
