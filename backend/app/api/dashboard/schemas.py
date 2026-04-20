from decimal import Decimal

from pydantic import BaseModel


class ApplicationStats(BaseModel):
    """Statistics for applications."""

    total: int = 0
    draft: int = 0
    pending_fee: int = 0
    in_review: int = 0
    accepted: int = 0
    rejected: int = 0
    withdrawn: int = 0


class AttendeeStats(BaseModel):
    """Statistics for attendees."""

    total: int = 0
    main: int = 0
    spouse: int = 0
    kid: int = 0


class PaymentStats(BaseModel):
    """Statistics for payments."""

    total: int = 0
    pending: int = 0
    approved: int = 0
    rejected: int = 0
    expired: int = 0
    cancelled: int = 0
    # Revenue metrics
    total_revenue: Decimal = Decimal("0")
    pending_revenue: Decimal = Decimal("0")
    approved_revenue: Decimal = Decimal("0")
    total_discounts: Decimal = Decimal("0")


class RecentActivity(BaseModel):
    """Recent activity item."""

    type: str  # "application", "attendee", "payment"
    description: str
    timestamp: str


# --- Enriched dashboard schemas ---


class KeyMetrics(BaseModel):
    """Top-level KPI cards with derived metrics."""

    people: int = 0
    total_revenue: Decimal = Decimal("0")
    currency: str = "USD"
    avg_ticket_price: Decimal = Decimal("0")
    avg_revenue_per_person: Decimal = Decimal("0")
    accommodation_percentage: Decimal = Decimal("0")
    conversion_rate: Decimal = Decimal("0")


class TimelinePoint(BaseModel):
    """Single data point in a time series."""

    date: str  # ISO date "2025-01-15"
    value: int = 0
    cumulative: int = 0


class RevenueTimelinePoint(BaseModel):
    """Single data point for revenue time series."""

    date: str
    value: Decimal = Decimal("0")
    cumulative: Decimal = Decimal("0")


class CumulativeTrends(BaseModel):
    """Time series for cumulative charts."""

    tickets: list[TimelinePoint] = []
    revenue: list[RevenueTimelinePoint] = []


class ProductBreakdownItem(BaseModel):
    """Revenue and quantity breakdown per product."""

    product_id: str
    product_name: str
    product_category: str
    quantity: int = 0
    revenue: Decimal = Decimal("0")


class CategoryBreakdown(BaseModel):
    """Aggregated breakdown by product category."""

    category: str
    label: str
    quantity: int = 0
    revenue: Decimal = Decimal("0")


class RevenueBreakdown(BaseModel):
    """Revenue split by product and category."""

    by_product: list[ProductBreakdownItem] = []
    by_category: list[CategoryBreakdown] = []


class DistributionItem(BaseModel):
    """Single slice in a distribution chart."""

    label: str
    value: int = 0
    percentage: Decimal = Decimal("0")


class AttachRateItem(BaseModel):
    """Accommodation attach rate per ticket type."""

    ticket_type: str
    total_attendees: int = 0
    with_accommodation: int = 0
    rate: Decimal = Decimal("0")


class Distribution(BaseModel):
    """Ticket and accommodation distribution."""

    tickets_by_duration: list[DistributionItem] = []
    tickets_by_attendee_type: list[DistributionItem] = []
    accommodation_by_product: list[DistributionItem] = []
    accommodation_attach_rate: list[AttachRateItem] = []


class ApplicationFunnel(BaseModel):
    """Application pipeline as a funnel."""

    draft: int = 0
    pending_fee: int = 0
    in_review: int = 0
    accepted: int = 0
    paid: int = 0


class DashboardStats(BaseModel):
    """Complete dashboard statistics."""

    applications: ApplicationStats
    attendees: AttendeeStats
    payments: PaymentStats


class EnrichedDashboardStats(BaseModel):
    """Full enriched dashboard response."""

    key_metrics: KeyMetrics
    cumulative_trends: CumulativeTrends
    revenue_breakdown: RevenueBreakdown
    distribution: Distribution
    application_funnel: ApplicationFunnel
    # Keep original detailed stats for backward compat
    applications: ApplicationStats
    attendees: AttendeeStats
    payments: PaymentStats
