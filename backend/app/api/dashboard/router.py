import uuid
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from sqlalchemy import func
from sqlmodel import select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.attendee.schemas import AttendeeCategory
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
from app.core.dependencies.users import CurrentUser, TenantSession

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: TenantSession,
    _: CurrentUser,
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
    _: CurrentUser,
    popup_id: uuid.UUID = Query(..., description="Popup ID to get stats for"),
) -> EnrichedDashboardStats:
    """Get enriched dashboard with KPIs, trends, breakdowns, and distributions."""
    # Base stats (reuse existing logic)
    app_stats = _get_application_stats(db, popup_id)
    attendee_stats = _get_attendee_stats(db, popup_id)
    payment_stats = _get_payment_stats(db, popup_id)

    # Enriched data
    key_metrics = _get_key_metrics(db, popup_id, attendee_stats, payment_stats)
    cumulative_trends = _get_cumulative_trends(db, popup_id)
    revenue_breakdown = _get_revenue_breakdown(db, popup_id)
    distribution = _get_distribution(db, popup_id)
    application_funnel = _get_application_funnel(app_stats, payment_stats)

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
    """Get attendee statistics for a popup."""
    category_counts = db.exec(
        select(Attendees.category, func.count(Attendees.id))
        .join(Applications, Attendees.application_id == Applications.id)
        .where(Applications.popup_id == popup_id)
        .group_by(Attendees.category)
    ).all()

    stats = AttendeeStats()
    for category_value, count in category_counts:
        stats.total += count
        if category_value == AttendeeCategory.MAIN.value:
            stats.main = count
        elif category_value == AttendeeCategory.SPOUSE.value:
            stats.spouse = count
        elif category_value == AttendeeCategory.KID.value:
            stats.kid = count

    return stats


def _get_payment_stats(db: TenantSession, popup_id: uuid.UUID) -> PaymentStats:
    """Get payment statistics for a popup."""
    payment_data = db.exec(
        select(
            Payments.status,
            func.count(Payments.id),
            func.coalesce(func.sum(Payments.amount), Decimal("0")),
            func.coalesce(func.sum(Payments.discount_value), Decimal("0")),
        )
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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
    attendee_stats: AttendeeStats,
    payment_stats: PaymentStats,
) -> KeyMetrics:
    """Compute high-level KPI cards."""
    people = attendee_stats.main
    revenue = payment_stats.approved_revenue
    approved_count = payment_stats.approved

    avg_ticket = (
        (revenue / approved_count).quantize(TWO_DECIMAL, ROUND_HALF_UP)
        if approved_count > 0
        else Decimal("0")
    )
    avg_per_person = (
        (revenue / people).quantize(TWO_DECIMAL, ROUND_HALF_UP)
        if people > 0
        else Decimal("0")
    )

    # Conversion: accepted applications / total non-draft applications
    total_non_draft = (
        payment_stats.approved + payment_stats.pending + payment_stats.rejected
    )
    conversion = (
        (Decimal(payment_stats.approved) / Decimal(total_non_draft) * 100).quantize(
            ONE_DECIMAL, ROUND_HALF_UP
        )
        if total_non_draft > 0
        else Decimal("0")
    )

    # Accommodation percentage: attendees with housing product / total main attendees
    accommodation_pct = _get_accommodation_percentage(db, popup_id, people)

    popup = popups_crud.get(db, popup_id)
    currency = popup.currency if popup else "USD"

    return KeyMetrics(
        people=people,
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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            PaymentProducts.product_category == CATEGORY_HOUSING,
        )
    ).one()

    count = housing_attendees or 0
    return (Decimal(count) / Decimal(total_people) * 100).quantize(
        ONE_DECIMAL, ROUND_HALF_UP
    )


def _get_cumulative_trends(db: TenantSession, popup_id: uuid.UUID) -> CumulativeTrends:
    """Daily cumulative trends for tickets (accepted apps) and revenue."""
    # Tickets: applications that reached accepted, grouped by accepted_at date
    ticket_rows = db.exec(
        select(
            func.date(Applications.accepted_at),
            func.count(Applications.id),
        )
        .where(
            Applications.popup_id == popup_id,
            Applications.status == ApplicationStatus.ACCEPTED.value,
            Applications.accepted_at.is_not(None),  # type: ignore[union-attr]
        )
        .group_by(func.date(Applications.accepted_at))
        .order_by(func.date(Applications.accepted_at))
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

    # Revenue: approved payments grouped by created_at date
    revenue_rows = db.exec(
        select(
            func.date(Payments.created_at),
            func.coalesce(func.sum(Payments.amount), Decimal("0")),
        )
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
        .group_by(func.date(Payments.created_at))
        .order_by(func.date(Payments.created_at))
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
    """Revenue and quantity breakdown by product and category."""
    rows = db.exec(
        select(
            PaymentProducts.product_id,
            PaymentProducts.product_name,
            PaymentProducts.product_category,
            func.sum(PaymentProducts.quantity),
            func.sum(PaymentProducts.product_price * PaymentProducts.quantity),
        )
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
        )
        .group_by(
            PaymentProducts.product_id,
            PaymentProducts.product_name,
            PaymentProducts.product_category,
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
        by_product.append(
            ProductBreakdownItem(
                product_id=str(product_id),
                product_name=name,
                product_category=category,
                quantity=qty or 0,
                revenue=rev or Decimal("0"),
            )
        )

        if category not in category_agg:
            category_agg[category] = CategoryBreakdown(
                category=category,
                label=category_labels.get(category, category.title()),
            )
        category_agg[category].quantity += qty or 0
        category_agg[category].revenue += rev or Decimal("0")

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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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

    # Tickets by attendee type
    attendee_type_rows = db.exec(
        select(
            Products.attendee_category,
            func.sum(PaymentProducts.quantity),
        )
        .join(PaymentProducts, Products.id == PaymentProducts.product_id)
        .join(Payments, PaymentProducts.payment_id == Payments.id)
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
            Payments.status == PaymentStatus.APPROVED.value,
            Payments.payment_type == PaymentType.PASS_PURCHASE.value,
            Products.category == CATEGORY_TICKET,
        )
        .group_by(Products.attendee_category)
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
            label=attendee_labels.get(cat, str(cat)),
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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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
        .join(Applications, Payments.application_id == Applications.id)
        .where(
            Applications.popup_id == popup_id,
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


def _get_application_funnel(
    app_stats: ApplicationStats, payment_stats: PaymentStats
) -> ApplicationFunnel:
    """Build application funnel from existing stats."""
    return ApplicationFunnel(
        draft=app_stats.draft,
        pending_fee=app_stats.pending_fee,
        in_review=app_stats.in_review,
        accepted=app_stats.accepted,
        paid=payment_stats.approved,
    )
