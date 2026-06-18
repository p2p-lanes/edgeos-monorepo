import uuid
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from sqlalchemy import and_, case, func
from sqlmodel import select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.dashboard.schemas import (
    ApplicationFunnel,
    ApplicationStats,
    AttachRateItem,
    AttendeeStats,
    CategoryBreakdown,
    CumulativeTrends,
    DashboardStats,
    Distribution,
    DistributionItem,
    EnrichedDashboardStats,
    KeyMetrics,
    PaymentStats,
    ProductBreakdownItem,
    RevenueBreakdown,
    RevenueTimelinePoint,
    TimelinePoint,
)
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.crud import popups_crud
from app.api.product.models import Products
from app.api.product.schemas import CATEGORY_HOUSING, CATEGORY_TICKET
from app.core.dependencies.users import CurrentOperator, TenantSession

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID = Query(..., description="Popup ID to get stats for"),
) -> DashboardStats:
    """Get registration statistics for a popup (legacy endpoint)."""
    return DashboardStats(
        applications=_get_application_stats(db, popup_id),
        attendees=_get_attendee_stats(db, popup_id),
        payments=_get_payment_stats(db, popup_id),
    )


@router.get("/enriched", response_model=EnrichedDashboardStats)
async def get_enriched_dashboard(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID = Query(..., description="Popup ID to get stats for"),
) -> EnrichedDashboardStats:
    """Get enriched dashboard with KPIs, trends, breakdowns, and distributions."""
    # Base stats (reuse existing logic)
    app_stats = _get_application_stats(db, popup_id)
    attendee_stats = _get_attendee_stats(db, popup_id)
    payment_stats = _get_payment_stats(db, popup_id)

    # Popup fetched once and shared (currency + application-fee flag)
    popup = popups_crud.get(db, popup_id)
    currency = popup.currency if popup else "USD"
    fee_enabled = bool(popup and popup.requires_application_fee)

    # Daily buckets follow the popup's local calendar, not UTC (matches the
    # rest of the app's timezone handling).
    from app.api.event_venue.router import _resolve_popup_timezone

    popup_tz = _resolve_popup_timezone(db, popup_id)

    # Enriched data
    key_metrics = _get_key_metrics(
        db, popup_id, app_stats, attendee_stats, payment_stats, currency
    )
    cumulative_trends = _get_cumulative_trends(db, popup_id, popup_tz)
    revenue_breakdown = _get_revenue_breakdown(db, popup_id)
    distribution = _get_distribution(db, popup_id)
    fee_paid = _get_fee_paid_count(db, popup_id) if fee_enabled else 0
    application_funnel = _get_application_funnel(app_stats, fee_paid, fee_enabled)

    return EnrichedDashboardStats(
        key_metrics=key_metrics,
        cumulative_trends=cumulative_trends,
        revenue_breakdown=revenue_breakdown,
        distribution=distribution,
        application_funnel=application_funnel,
        applications=app_stats,
        attendees=attendee_stats,
        payments=payment_stats,
    )


# ---------------------------------------------------------------------------
# Base stats (unchanged)
# ---------------------------------------------------------------------------


def _get_application_stats(db: TenantSession, popup_id: uuid.UUID) -> ApplicationStats:
    """Get application statistics for a popup."""
    status_counts = db.exec(
        select(Applications.status, func.count(Applications.id))
        .where(Applications.popup_id == popup_id)
        .group_by(Applications.status)
    ).all()

    stats = ApplicationStats()
    for status_value, count in status_counts:
        stats.total += count
        if status_value == ApplicationStatus.DRAFT.value:
            stats.draft = count
        elif status_value == ApplicationStatus.PENDING_FEE.value:
            stats.pending_fee = count
        elif status_value == ApplicationStatus.IN_REVIEW.value:
            stats.in_review = count
        elif status_value == ApplicationStatus.ACCEPTED.value:
            stats.accepted = count
        elif status_value == ApplicationStatus.REJECTED.value:
            stats.rejected = count
        elif status_value == ApplicationStatus.WITHDRAWN.value:
            stats.withdrawn = count

    return stats


def _get_attendee_stats(db: TenantSession, popup_id: uuid.UUID) -> AttendeeStats:
    """Get attendee statistics for a popup.

    Scoped by the denormalized Attendees.popup_id so direct-sale attendees
    (application_id IS NULL) are included in the headcount. Groups by
    AttendeeCategories.key (via category_id FK) since the legacy
    attendees.category string column was dropped in PR 2.
    """
    category_counts = db.exec(
        select(AttendeeCategories.key, func.count(Attendees.id))
        .select_from(Attendees)
        .outerjoin(AttendeeCategories, Attendees.category_id == AttendeeCategories.id)
        .where(Attendees.popup_id == popup_id)
        .group_by(AttendeeCategories.key)
    ).all()

    stats = AttendeeStats()
    for category_key, count in category_counts:
        stats.total += count
        if category_key == "main":
            stats.main = count
        elif category_key == "spouse":
            stats.spouse = count
        elif category_key == "kid":
            stats.kid = count

    return stats


def _get_payment_stats(db: TenantSession, popup_id: uuid.UUID) -> PaymentStats:
    """Get payment statistics for a popup."""
    payment_data = db.exec(
        select(
            Payments.status,
            func.count(Payments.id),
            # amount_charged is the settled total when SimpleFi applied a
            # per-rail price adjustment; fall back to the quoted amount.
            func.coalesce(
                func.sum(func.coalesce(Payments.amount_charged, Payments.amount)),
                Decimal("0"),
            ),
            func.coalesce(func.sum(Payments.discount_value), Decimal("0")),
        )
        .where(
            Payments.popup_id == popup_id,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
        .group_by(Payments.status)
    ).all()

    stats = PaymentStats()
    for status_value, count, amount_sum, discount_sum in payment_data:
        stats.total += count
        stats.total_revenue += amount_sum
        stats.total_discounts += discount_sum

        if status_value == PaymentStatus.PENDING.value:
            stats.pending = count
            stats.pending_revenue = amount_sum
        elif status_value == PaymentStatus.APPROVED.value:
            stats.approved = count
            stats.approved_revenue = amount_sum
        elif status_value == PaymentStatus.REJECTED.value:
            stats.rejected = count
        elif status_value == PaymentStatus.EXPIRED.value:
            stats.expired = count
        elif status_value == PaymentStatus.CANCELLED.value:
            stats.cancelled = count

    return stats


# ---------------------------------------------------------------------------
# Enriched metrics
# ---------------------------------------------------------------------------

TWO_DECIMAL = Decimal("0.01")
ONE_DECIMAL = Decimal("0.1")


def _get_key_metrics(
    db: TenantSession,
    popup_id: uuid.UUID,
    app_stats: ApplicationStats,
    attendee_stats: AttendeeStats,
    payment_stats: PaymentStats,
    currency: str,
) -> KeyMetrics:
    """Compute high-level KPI cards."""
    # People = total headcount (all attendees, paid or not). Revenue-per-person
    # uses only paying attendees so sponsors/guests/comps don't dilute it.
    people = attendee_stats.total
    paying_people = _get_paying_attendees_count(db, popup_id)
    revenue = payment_stats.approved_revenue
    approved_count = payment_stats.approved

    avg_ticket = (
        (revenue / approved_count).quantize(TWO_DECIMAL, ROUND_HALF_UP)
        if approved_count > 0
        else Decimal("0")
    )
    avg_per_person = (
        (revenue / paying_people).quantize(TWO_DECIMAL, ROUND_HALF_UP)
        if paying_people > 0
        else Decimal("0")
    )

    # Conversion (acceptance rate): accepted / decided applications
    # (accepted + rejected). In-review/pending-fee (undecided) and withdrawn
    # (self-removed) are excluded so the rate reflects real accept/reject
    # decisions, not in-flight queue depth.
    decided = app_stats.accepted + app_stats.rejected
    conversion = (
        (Decimal(app_stats.accepted) / Decimal(decided) * 100).quantize(
            ONE_DECIMAL, ROUND_HALF_UP
        )
        if decided > 0
        else Decimal("0")
    )

    # Accommodation percentage: attendees with housing product / total headcount
    accommodation_pct = _get_accommodation_percentage(db, popup_id, people)

    return KeyMetrics(
        people=people,
        paying_people=paying_people,
        total_revenue=revenue,
        currency=currency,
        avg_ticket_price=avg_ticket,
        avg_revenue_per_person=avg_per_person,
        accommodation_percentage=accommodation_pct,
        conversion_rate=conversion,
    )


def _get_accommodation_percentage(
    db: TenantSession, popup_id: uuid.UUID, total_people: int
) -> Decimal:
    """Percentage of main attendees that have a housing product (paid)."""
    if total_people == 0:
        return Decimal("0")

    # Count distinct attendees with an approved housing payment product
    housing_attendees = db.exec(
        select(func.count(func.distinct(PaymentProducts.attendee_id)))
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            PaymentProducts.product_category == CATEGORY_HOUSING,
        )
    ).one()

    count = housing_attendees or 0
    return (Decimal(count) / Decimal(total_people) * 100).quantize(
        ONE_DECIMAL, ROUND_HALF_UP
    )


def _get_paying_attendees_count(db: TenantSession, popup_id: uuid.UUID) -> int:
    """Count distinct attendees with at least one approved pass_purchase product.

    Denominator for revenue-per-person: only people who actually paid, so
    non-paying attendees (sponsors, guests, comps) don't dilute the average.
    """
    count = db.exec(
        select(func.count(func.distinct(PaymentProducts.attendee_id)))
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
    ).one()
    return count or 0


def _get_cumulative_trends(
    db: TenantSession, popup_id: uuid.UUID, tz_name: str
) -> CumulativeTrends:
    """Daily cumulative trends for tickets sold and revenue.

    Both series are bucketed by payment date in the popup's timezone, so day
    boundaries follow the event's local calendar (not UTC) and the two curves
    share the same time axis.
    """
    bucket = func.date(func.timezone(tz_name, Payments.created_at))

    # Tickets sold: ticket-category product quantity on approved purchases
    ticket_rows = db.exec(
        select(bucket, func.coalesce(func.sum(PaymentProducts.quantity), 0))
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            PaymentProducts.product_category == CATEGORY_TICKET,
        )
        .group_by(bucket)
        .order_by(bucket)
    ).all()

    tickets: list[TimelinePoint] = []
    cumulative = 0
    for date_val, count in ticket_rows:
        cumulative += count
        tickets.append(
            TimelinePoint(
                date=str(date_val),
                value=count,
                cumulative=cumulative,
            )
        )

    # Revenue: approved pass_purchase amount on the same payment-date axis
    revenue_rows = db.exec(
        select(
            bucket,
            func.coalesce(
                func.sum(func.coalesce(Payments.amount_charged, Payments.amount)),
                Decimal("0"),
            ),
        )
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
        .group_by(bucket)
        .order_by(bucket)
    ).all()

    revenue: list[RevenueTimelinePoint] = []
    cum_revenue = Decimal("0")
    for date_val, amount in revenue_rows:
        cum_revenue += amount
        revenue.append(
            RevenueTimelinePoint(
                date=str(date_val),
                value=amount,
                cumulative=cum_revenue,
            )
        )

    return CumulativeTrends(tickets=tickets, revenue=revenue)


def _get_revenue_breakdown(db: TenantSession, popup_id: uuid.UUID) -> RevenueBreakdown:
    """Net revenue and quantity breakdown by product and category.

    Revenue is anchored on what was actually collected, never reconstructed from
    list prices. For each approved pass-purchase payment we take the settled
    total (COALESCE(amount_charged, amount) minus insurance and contribution
    fees, which are not product lines) and split it across the payment's lines
    the same way the pricing engine charged it (payment.crud._calculate_price):
    non-discountable lines and patreon donations keep their full nominal value,
    and only discountable lines absorb the discount, sharing whatever remains of
    the settled total in proportion to their list price. This reconciles with
    the Total Revenue KPI by construction, regardless of how a coupon, group
    rate, scholarship or admin comp reduced the amount, none of which are
    itemised per line.

    Nominal value comes from effective_unit_price when set (patreon donations,
    whose product_price is 0, and direct-sale unit-price overrides) and from the
    snapshot product_price otherwise. When the settled total can't cover the
    non-discountable lines at full price (a comp, or a legacy-migrated payment
    whose snapshot price was overwritten with the current, higher catalog price)
    the payment falls back to a plain proportional split so it still reconciles
    and never goes negative.
    """
    # Per-line nominal value: donation/override price when present, else the
    # snapshot list price. Used as the allocation weight within a payment.
    line_nominal = (
        func.coalesce(
            PaymentProducts.effective_unit_price, PaymentProducts.product_price
        )
        * PaymentProducts.quantity
    )
    # A product missing from the catalog (deleted) is treated as non-discountable.
    is_discountable = case((Products.discountable.is_(True), 1), else_=0)
    # Settled total per payment, excluding non-product fees. Same basis as the
    # Total Revenue KPI in _get_payment_stats.
    net_payment = (
        func.coalesce(Payments.amount_charged, Payments.amount)
        - Payments.insurance_amount
        - Payments.contribution_amount
    )

    lines = (
        select(
            PaymentProducts.product_id.label("product_id"),
            PaymentProducts.product_name.label("product_name"),
            PaymentProducts.product_category.label("product_category"),
            PaymentProducts.quantity.label("quantity"),
            line_nominal.label("nominal"),
            is_discountable.label("is_discountable"),
            net_payment.label("net_payment"),
            func.sum(line_nominal)
            .over(partition_by=PaymentProducts.payment_id)
            .label("nominal_total"),
            func.sum(line_nominal * is_discountable)
            .over(partition_by=PaymentProducts.payment_id)
            .label("discountable_total"),
            func.sum(line_nominal * (1 - is_discountable))
            .over(partition_by=PaymentProducts.payment_id)
            .label("non_discountable_total"),
        )
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .join(Products, PaymentProducts.product_id == Products.id, isouter=True)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
        .subquery()
    )

    # Money left for the discountable bucket once non-discountable lines are paid
    # in full.
    remainder = lines.c.net_payment - lines.c.non_discountable_total
    allocated_revenue = case(
        (
            # Normal path: non-discountable lines at full nominal; discountable
            # lines share the remainder weighted by list price.
            and_(lines.c.discountable_total > 0, remainder >= 0),
            case(
                (
                    lines.c.is_discountable == 1,
                    remainder * lines.c.nominal / lines.c.discountable_total,
                ),
                else_=lines.c.nominal,
            ),
        ),
        # Fallback: settled total can't cover non-discountable lines (comp or
        # inflated legacy snapshot) -> plain proportional split.
        (
            lines.c.nominal_total > 0,
            lines.c.net_payment * lines.c.nominal / lines.c.nominal_total,
        ),
        else_=Decimal("0"),
    )

    rows = db.exec(
        select(
            lines.c.product_id,
            lines.c.product_name,
            lines.c.product_category,
            func.sum(lines.c.quantity),
            func.sum(allocated_revenue),
        ).group_by(
            lines.c.product_id,
            lines.c.product_name,
            lines.c.product_category,
        )
    ).all()

    by_product: list[ProductBreakdownItem] = []
    category_agg: dict[str, CategoryBreakdown] = {}

    category_labels = {
        "ticket": "Tickets",
        "housing": "Accommodation",
        "merch": "Merchandise",
        "other": "Other",
        "patreon": "Patreon",
    }

    for product_id, name, category, qty, rev in rows:
        revenue = (rev or Decimal("0")).quantize(TWO_DECIMAL, ROUND_HALF_UP)
        by_product.append(
            ProductBreakdownItem(
                product_id=str(product_id),
                product_name=name,
                product_category=category,
                quantity=qty or 0,
                revenue=revenue,
            )
        )

        if category not in category_agg:
            category_agg[category] = CategoryBreakdown(
                category=category,
                label=category_labels.get(category, category.title()),
            )
        category_agg[category].quantity += qty or 0
        category_agg[category].revenue += revenue

    return RevenueBreakdown(
        by_product=by_product,
        by_category=list(category_agg.values()),
    )


def _get_distribution(db: TenantSession, popup_id: uuid.UUID) -> Distribution:
    """Ticket and accommodation distribution."""
    # Tickets by duration type (from paid payment products)
    duration_rows = db.exec(
        select(
            Products.duration_type,
            func.sum(PaymentProducts.quantity),
        )
        .join(PaymentProducts, Products.id == PaymentProducts.product_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            Products.category == CATEGORY_TICKET,
        )
        .group_by(Products.duration_type)
    ).all()

    duration_labels = {
        "day": "Day Pass",
        "week": "Week Pass",
        "month": "Month Pass",
        "full": "Full Event",
        None: "Unspecified",
    }

    total_tickets = sum((qty or 0) for _, qty in duration_rows)
    tickets_by_duration = [
        DistributionItem(
            label=duration_labels.get(dur, str(dur)),
            value=qty or 0,
            percentage=(
                (Decimal(qty or 0) / Decimal(total_tickets) * 100).quantize(
                    ONE_DECIMAL, ROUND_HALF_UP
                )
                if total_tickets > 0
                else Decimal("0")
            ),
        )
        for dur, qty in duration_rows
    ]

    # Tickets by attendee type (grouped by AttendeeCategories.key via FK)
    # Products.attendee_category column was dropped in PR 2; use attendee_category_id FK.
    attendee_type_rows = db.exec(
        select(
            AttendeeCategories.key,
            func.sum(PaymentProducts.quantity),
        )
        .select_from(Products)
        .join(PaymentProducts, Products.id == PaymentProducts.product_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .outerjoin(
            AttendeeCategories,
            Products.attendee_category_id == AttendeeCategories.id,
        )
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            Products.category == CATEGORY_TICKET,
        )
        .group_by(AttendeeCategories.key)
    ).all()

    attendee_labels = {
        "main": "Main",
        "spouse": "Spouse",
        "kid": "Kids",
        None: "General",
    }

    total_att_tickets = sum((qty or 0) for _, qty in attendee_type_rows)
    tickets_by_attendee_type = [
        DistributionItem(
            label=attendee_labels.get(cat, str(cat) if cat else "General"),
            value=qty or 0,
            percentage=(
                (Decimal(qty or 0) / Decimal(total_att_tickets) * 100).quantize(
                    ONE_DECIMAL, ROUND_HALF_UP
                )
                if total_att_tickets > 0
                else Decimal("0")
            ),
        )
        for cat, qty in attendee_type_rows
    ]

    # Accommodation by product name
    housing_rows = db.exec(
        select(
            PaymentProducts.product_name,
            func.sum(PaymentProducts.quantity),
        )
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            PaymentProducts.product_category == CATEGORY_HOUSING,
        )
        .group_by(PaymentProducts.product_name)
    ).all()

    total_housing = sum((qty or 0) for _, qty in housing_rows)
    accommodation_by_product = [
        DistributionItem(
            label=name,
            value=qty or 0,
            percentage=(
                (Decimal(qty or 0) / Decimal(total_housing) * 100).quantize(
                    ONE_DECIMAL, ROUND_HALF_UP
                )
                if total_housing > 0
                else Decimal("0")
            ),
        )
        for name, qty in housing_rows
    ]

    # Accommodation attach rate per ticket duration type
    attach_rate = _get_attach_rate(db, popup_id)

    return Distribution(
        tickets_by_duration=tickets_by_duration,
        tickets_by_attendee_type=tickets_by_attendee_type,
        accommodation_by_product=accommodation_by_product,
        accommodation_attach_rate=attach_rate,
    )


def _get_attach_rate(db: TenantSession, popup_id: uuid.UUID) -> list[AttachRateItem]:
    """Compute accommodation attach rate per ticket duration type."""
    # Step 1: All attendees with an approved ticket, grouped by duration_type
    ticket_attendees = db.exec(
        select(
            Products.duration_type,
            func.count(func.distinct(PaymentProducts.attendee_id)),
        )
        .join(PaymentProducts, Products.id == PaymentProducts.product_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            Products.category == CATEGORY_TICKET,
        )
        .group_by(Products.duration_type)
    ).all()

    if not ticket_attendees:
        return []

    # Step 2: Of those, which also have housing
    # Subquery: attendee_ids that have housing
    housing_attendee_ids = (
        select(PaymentProducts.attendee_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            PaymentProducts.product_category == CATEGORY_HOUSING,
        )
    ).correlate(None)

    housing_by_duration = db.exec(
        select(
            Products.duration_type,
            func.count(func.distinct(PaymentProducts.attendee_id)),
        )
        .join(PaymentProducts, Products.id == PaymentProducts.product_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .where(
            Payments.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            Products.category == CATEGORY_TICKET,
            PaymentProducts.attendee_id.in_(housing_attendee_ids),  # type: ignore[union-attr]
        )
        .group_by(Products.duration_type)
    ).all()

    housing_map = dict(housing_by_duration)
    duration_labels = {
        "day": "Day Pass",
        "week": "Week Pass",
        "month": "Month Pass",
        "full": "Full Event",
        None: "Unspecified",
    }

    result: list[AttachRateItem] = []
    for dur, total in ticket_attendees:
        with_housing = housing_map.get(dur, 0)
        rate = (
            (Decimal(with_housing) / Decimal(total) * 100).quantize(
                ONE_DECIMAL, ROUND_HALF_UP
            )
            if total > 0
            else Decimal("0")
        )
        result.append(
            AttachRateItem(
                ticket_type=duration_labels.get(dur, str(dur)),
                total_attendees=total,
                with_accommodation=with_housing,
                rate=rate,
            )
        )

    return result


def _get_fee_paid_count(db: TenantSession, popup_id: uuid.UUID) -> int:
    """Count applications with an approved application_fee payment.

    'Paid' in the funnel means the application fee was paid, an intermediate
    stage between pending_fee and review. Counts distinct applications (not
    payment rows) so multiple fee payments on one application don't inflate it.
    """
    count = db.exec(
        select(func.count(func.distinct(Payments.application_id)))
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
            Payments.payment_type == PaymentType.APPLICATION_FEE.value,
            Payments.status == PaymentStatus.APPROVED.value,
        )
    ).one()
    return count or 0


def _get_application_funnel(
    app_stats: ApplicationStats, fee_paid: int, fee_enabled: bool
) -> ApplicationFunnel:
    """Build application funnel from existing stats."""
    return ApplicationFunnel(
        draft=app_stats.draft,
        pending_fee=app_stats.pending_fee,
        paid=fee_paid,
        in_review=app_stats.in_review,
        accepted=app_stats.accepted,
        fee_enabled=fee_enabled,
    )
