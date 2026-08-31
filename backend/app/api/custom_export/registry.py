from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy.orm import selectinload

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.product.models import Products

Sensitivity = Literal["internal", "pii", "financial", "security"]
Scope = Literal["organization", "gathering"]

_STRING_FILTERS = (
    "eq",
    "neq",
    "contains",
    "not_contains",
    "in",
    "is_empty",
    "not_empty",
)
_NUMBER_FILTERS = ("eq", "neq", "in", "gt", "gte", "lt", "lte", "is_empty", "not_empty")
_DATE_FILTERS = ("eq", "neq", "before", "after", "is_empty", "not_empty")
_BOOLEAN_FILTERS = ("eq", "neq")


@dataclass(frozen=True)
class ExportFieldDefinition:
    field: str
    label: str
    type: str
    sensitivity: Sensitivity
    extractor: Callable[[Any], Any]
    filter_operators: tuple[str, ...]


@dataclass(frozen=True)
class ExportDatasetDefinition:
    dataset: str
    label: str
    description: str
    scope: Scope
    row_label: str
    model: type
    fields: tuple[ExportFieldDefinition, ...]
    option_factories: tuple[Callable[[], Any], ...] = ()
    popup_mode: Literal["column", "attendee_join", "none"] = "none"
    exclude_deleted: bool = False

    @property
    def fields_by_name(self) -> dict[str, ExportFieldDefinition]:
        return {field.field: field for field in self.fields}


def _field(
    field: str,
    label: str,
    type_: str,
    extractor: Callable[[Any], Any],
    sensitivity: Sensitivity = "internal",
) -> ExportFieldDefinition:
    operators = {
        "string": _STRING_FILTERS,
        "uuid": _STRING_FILTERS,
        "number": _NUMBER_FILTERS,
        "datetime": _DATE_FILTERS,
        "boolean": _BOOLEAN_FILTERS,
    }.get(type_, _STRING_FILTERS)
    return ExportFieldDefinition(
        field=field,
        label=label,
        type=type_,
        sensitivity=sensitivity,
        extractor=extractor,
        filter_operators=operators,
    )


def _join(values: list[Any]) -> str:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return " | ".join(unique)


def _human_name(human: Humans | None) -> str | None:
    return human.display_name if human else None


def _application_tickets(application: Applications) -> list[AttendeeProducts]:
    return [
        ticket
        for attendee in application.attendees
        for ticket in attendee.attendee_products
    ]


def _approved_payments(application: Applications) -> list[Payments]:
    return [payment for payment in application.payments if payment.status == "approved"]


def _effective_payment_amount(payment: Payments) -> Decimal:
    return (
        payment.amount_charged if payment.amount_charged is not None else payment.amount
    )


APPLICATIONS = ExportDatasetDefinition(
    dataset="applications",
    label="Applications",
    description="Applications enriched with applicant, attendee, ticket, product, and payment data.",
    scope="gathering",
    row_label="application",
    model=Applications,
    popup_mode="column",
    option_factories=(
        lambda: selectinload(Applications.human),
        lambda: selectinload(Applications.attendees)
        .selectinload(Attendees.attendee_products)
        .selectinload(AttendeeProducts.product),
        lambda: selectinload(Applications.payments),
    ),
    fields=(
        _field("application.id", "Application ID", "uuid", lambda row: row.id),
        _field(
            "application.status", "Application status", "string", lambda row: row.status
        ),
        _field(
            "application.created_at",
            "Created at",
            "datetime",
            lambda row: row.created_at,
        ),
        _field(
            "application.submitted_at",
            "Submitted at",
            "datetime",
            lambda row: row.submitted_at,
        ),
        _field(
            "application.accepted_at",
            "Accepted at",
            "datetime",
            lambda row: row.accepted_at,
        ),
        _field("application.referral", "Referral", "string", lambda row: row.referral),
        _field(
            "application.credit",
            "Available credit",
            "number",
            lambda row: row.credit,
            "financial",
        ),
        _field(
            "application.scholarship_request",
            "Scholarship requested",
            "boolean",
            lambda row: row.scholarship_request,
        ),
        _field(
            "application.scholarship_status",
            "Scholarship status",
            "string",
            lambda row: row.scholarship_status,
        ),
        _field("human.id", "Human ID", "uuid", lambda row: row.human_id),
        _field(
            "human.full_name",
            "Applicant name",
            "string",
            lambda row: _human_name(row.human),
            "pii",
        ),
        _field(
            "human.email",
            "Applicant email",
            "string",
            lambda row: row.human.email if row.human else None,
            "pii",
        ),
        _field(
            "human.telegram",
            "Applicant Telegram",
            "string",
            lambda row: row.human.telegram if row.human else None,
            "pii",
        ),
        _field(
            "human.gender",
            "Applicant gender",
            "string",
            lambda row: row.human.gender if row.human else None,
            "pii",
        ),
        _field(
            "human.age",
            "Applicant age",
            "string",
            lambda row: row.human.age if row.human else None,
            "pii",
        ),
        _field(
            "human.residence",
            "Applicant residence",
            "string",
            lambda row: row.human.residence if row.human else None,
            "pii",
        ),
        _field(
            "human.rating",
            "Human rating",
            "string",
            lambda row: row.human.rating if row.human else None,
        ),
        _field(
            "attendees.count",
            "Attendee count",
            "number",
            lambda row: len(row.attendees),
        ),
        _field(
            "attendees.names",
            "Attendee names",
            "string",
            lambda row: _join([attendee.name for attendee in row.attendees]),
            "pii",
        ),
        _field(
            "attendees.emails",
            "Attendee emails",
            "string",
            lambda row: _join([attendee.email for attendee in row.attendees]),
            "pii",
        ),
        _field(
            "tickets.count",
            "Current ticket count",
            "number",
            lambda row: len(_application_tickets(row)),
        ),
        _field(
            "products.names",
            "Current product names",
            "string",
            lambda row: _join(
                [
                    ticket.product.name if ticket.product else None
                    for ticket in _application_tickets(row)
                ]
            ),
        ),
        _field(
            "payments.count",
            "Payment count",
            "number",
            lambda row: len(row.payments),
            "financial",
        ),
        _field(
            "payments.statuses",
            "Payment statuses",
            "string",
            lambda row: _join([payment.status for payment in row.payments]),
            "financial",
        ),
        _field(
            "payments.approved_count",
            "Approved payment count",
            "number",
            lambda row: len(_approved_payments(row)),
            "financial",
        ),
        _field(
            "payments.approved_total",
            "Approved payment total",
            "number",
            lambda row: sum(
                (
                    _effective_payment_amount(payment)
                    for payment in _approved_payments(row)
                ),
                Decimal("0"),
            ),
            "financial",
        ),
        _field(
            "payments.currencies",
            "Payment currencies",
            "string",
            lambda row: _join(
                [payment.currency for payment in _approved_payments(row)]
            ),
            "financial",
        ),
    ),
)


ATTENDEES = ExportDatasetDefinition(
    dataset="attendees",
    label="Attendees",
    description="Attendees enriched with application, human, ticket, and product data.",
    scope="gathering",
    row_label="attendee",
    model=Attendees,
    popup_mode="column",
    option_factories=(
        lambda: selectinload(Attendees.human),
        lambda: selectinload(Attendees.application).selectinload(Applications.human),
        lambda: selectinload(Attendees.category_ref),
        lambda: selectinload(Attendees.attendee_products).selectinload(
            AttendeeProducts.product
        ),
    ),
    fields=(
        _field("attendee.id", "Attendee ID", "uuid", lambda row: row.id),
        _field("attendee.name", "Attendee name", "string", lambda row: row.name, "pii"),
        _field(
            "attendee.email", "Attendee email", "string", lambda row: row.email, "pii"
        ),
        _field(
            "attendee.category", "Attendee category", "string", lambda row: row.category
        ),
        _field(
            "attendee.gender",
            "Attendee gender",
            "string",
            lambda row: row.gender,
            "pii",
        ),
        _field(
            "attendee.age_group",
            "Age group",
            "string",
            lambda row: (row.additional_data or {}).get("age_group")
            or (row.additional_data or {}).get("age"),
            "pii",
        ),
        _field(
            "attendee.created_at", "Created at", "datetime", lambda row: row.created_at
        ),
        _field(
            "application.id", "Application ID", "uuid", lambda row: row.application_id
        ),
        _field(
            "application.status",
            "Application status",
            "string",
            lambda row: row.application.status if row.application else None,
        ),
        _field("human.id", "Human ID", "uuid", lambda row: row.human_id),
        _field(
            "human.full_name",
            "Human name",
            "string",
            lambda row: _human_name(row.human),
            "pii",
        ),
        _field(
            "human.email",
            "Human email",
            "string",
            lambda row: row.human.email if row.human else None,
            "pii",
        ),
        _field(
            "tickets.count",
            "Ticket count",
            "number",
            lambda row: len(row.attendee_products),
        ),
        _field(
            "tickets.ids",
            "Ticket IDs",
            "string",
            lambda row: _join([ticket.id for ticket in row.attendee_products]),
        ),
        _field(
            "tickets.payment_ids",
            "Payment IDs",
            "string",
            lambda row: _join([ticket.payment_id for ticket in row.attendee_products]),
            "financial",
        ),
        _field(
            "products.names",
            "Product names",
            "string",
            lambda row: _join(
                [
                    ticket.product.name if ticket.product else None
                    for ticket in row.attendee_products
                ]
            ),
        ),
        _field(
            "products.categories",
            "Product categories",
            "string",
            lambda row: _join(
                [
                    ticket.product.category if ticket.product else None
                    for ticket in row.attendee_products
                ]
            ),
        ),
    ),
)


PAYMENTS = ExportDatasetDefinition(
    dataset="payments",
    label="Payments",
    description="Payments enriched with buyer, application, purchased product, and attendee snapshots.",
    scope="gathering",
    row_label="payment",
    model=Payments,
    popup_mode="column",
    option_factories=(
        lambda: selectinload(Payments.application).selectinload(Applications.human),
        lambda: selectinload(Payments.products_snapshot).selectinload(
            PaymentProducts.product
        ),
        lambda: selectinload(Payments.products_snapshot)
        .selectinload(PaymentProducts.attendee)
        .selectinload(Attendees.human),
    ),
    fields=(
        _field("payment.id", "Payment ID", "uuid", lambda row: row.id),
        _field(
            "payment.status",
            "Payment status",
            "string",
            lambda row: row.status,
            "financial",
        ),
        _field(
            "payment.amount",
            "Quoted amount",
            "number",
            lambda row: row.amount,
            "financial",
        ),
        _field(
            "payment.amount_charged",
            "Amount charged",
            "number",
            lambda row: row.amount_charged,
            "financial",
        ),
        _field(
            "payment.effective_amount",
            "Effective charged amount",
            "number",
            lambda row: _effective_payment_amount(row),
            "financial",
        ),
        _field(
            "payment.currency",
            "Currency",
            "string",
            lambda row: row.currency,
            "financial",
        ),
        _field(
            "payment.source",
            "Payment source",
            "string",
            lambda row: row.source,
            "financial",
        ),
        _field(
            "payment.type",
            "Payment type",
            "string",
            lambda row: row.payment_type,
            "financial",
        ),
        _field(
            "payment.external_id",
            "External payment ID",
            "string",
            lambda row: row.external_id,
            "financial",
        ),
        _field(
            "payment.created_at", "Created at", "datetime", lambda row: row.created_at
        ),
        _field(
            "payment.coupon_code",
            "Coupon code",
            "string",
            lambda row: row.coupon_code,
            "financial",
        ),
        _field(
            "payment.discount_value",
            "Discount value",
            "number",
            lambda row: row.discount_value,
            "financial",
        ),
        _field(
            "payment.credit_applied",
            "Credit applied",
            "number",
            lambda row: row.credit_applied,
            "financial",
        ),
        _field(
            "payment.is_installment_plan",
            "Installment plan",
            "boolean",
            lambda row: row.is_installment_plan,
            "financial",
        ),
        _field(
            "payment.installments_paid",
            "Installments paid",
            "number",
            lambda row: row.installments_paid,
            "financial",
        ),
        _field(
            "payment.installments_total",
            "Installments total",
            "number",
            lambda row: row.installments_total,
            "financial",
        ),
        _field(
            "application.id", "Application ID", "uuid", lambda row: row.application_id
        ),
        _field(
            "application.status",
            "Application status",
            "string",
            lambda row: row.application.status if row.application else None,
        ),
        _field("buyer.name", "Buyer name", "string", lambda row: row.buyer_name, "pii"),
        _field(
            "buyer.email", "Buyer email", "string", lambda row: row.buyer_email, "pii"
        ),
        _field(
            "products.names",
            "Purchased product names",
            "string",
            lambda row: _join(
                [product.product_name for product in row.products_snapshot]
            ),
        ),
        _field(
            "products.categories",
            "Purchased product categories",
            "string",
            lambda row: _join(
                [product.product_category for product in row.products_snapshot]
            ),
        ),
        _field(
            "products.quantity",
            "Purchased quantity",
            "number",
            lambda row: sum(product.quantity for product in row.products_snapshot),
        ),
        _field(
            "attendees.names",
            "Attendee names",
            "string",
            lambda row: _join(
                [product.attendee_name for product in row.products_snapshot]
            ),
            "pii",
        ),
    ),
)


HUMANS = ExportDatasetDefinition(
    dataset="humans",
    label="Humans",
    description="Organization-level people enriched with applications, attendees, tickets, and approved payments.",
    scope="organization",
    row_label="human",
    model=Humans,
    option_factories=(
        lambda: selectinload(Humans.applications).selectinload(Applications.payments),
        lambda: selectinload(Humans.applications)
        .selectinload(Applications.attendees)
        .selectinload(Attendees.attendee_products)
        .selectinload(AttendeeProducts.product),
        lambda: selectinload(Humans.attendees).selectinload(
            Attendees.attendee_products
        ),
    ),
    fields=(
        _field("human.id", "Human ID", "uuid", lambda row: row.id),
        _field(
            "human.full_name",
            "Full name",
            "string",
            lambda row: row.display_name,
            "pii",
        ),
        _field(
            "human.first_name",
            "First name",
            "string",
            lambda row: row.first_name,
            "pii",
        ),
        _field(
            "human.last_name", "Last name", "string", lambda row: row.last_name, "pii"
        ),
        _field("human.email", "Email", "string", lambda row: row.email, "pii"),
        _field("human.telegram", "Telegram", "string", lambda row: row.telegram, "pii"),
        _field("human.gender", "Gender", "string", lambda row: row.gender, "pii"),
        _field("human.age", "Age", "string", lambda row: row.age, "pii"),
        _field(
            "human.residence", "Residence", "string", lambda row: row.residence, "pii"
        ),
        _field("human.rating", "Rating", "string", lambda row: row.rating),
        _field(
            "applications.count",
            "Application count",
            "number",
            lambda row: len(row.applications),
        ),
        _field(
            "applications.statuses",
            "Application statuses",
            "string",
            lambda row: _join([application.status for application in row.applications]),
        ),
        _field(
            "applications.accepted_count",
            "Accepted application count",
            "number",
            lambda row: sum(
                application.status == "accepted" for application in row.applications
            ),
        ),
        _field(
            "attendees.count",
            "Attendee count",
            "number",
            lambda row: len(row.attendees),
        ),
        _field(
            "tickets.count",
            "Current ticket count",
            "number",
            lambda row: sum(
                len(attendee.attendee_products) for attendee in row.attendees
            ),
        ),
        _field(
            "payments.approved_count",
            "Application-linked approved payment count",
            "number",
            lambda row: sum(
                len(_approved_payments(application)) for application in row.applications
            ),
            "financial",
        ),
        _field(
            "payments.approved_total",
            "Application-linked approved payment total",
            "number",
            lambda row: sum(
                (
                    _effective_payment_amount(payment)
                    for application in row.applications
                    for payment in _approved_payments(application)
                ),
                Decimal("0"),
            ),
            "financial",
        ),
        _field(
            "payments.currencies",
            "Application-linked payment currencies",
            "string",
            lambda row: _join(
                [
                    payment.currency
                    for application in row.applications
                    for payment in _approved_payments(application)
                ]
            ),
            "financial",
        ),
    ),
)


PRODUCTS = ExportDatasetDefinition(
    dataset="products",
    label="Products",
    description="Products enriched with current ticket assignments and purchase snapshot totals.",
    scope="gathering",
    row_label="product",
    model=Products,
    popup_mode="column",
    exclude_deleted=True,
    option_factories=(
        lambda: selectinload(Products.attendee_products),
        lambda: selectinload(Products.payment_products),
    ),
    fields=(
        _field("product.id", "Product ID", "uuid", lambda row: row.id),
        _field("product.name", "Product name", "string", lambda row: row.name),
        _field("product.slug", "Product slug", "string", lambda row: row.slug),
        _field(
            "product.category", "Product category", "string", lambda row: row.category
        ),
        _field("product.price", "Price", "number", lambda row: row.price, "financial"),
        _field("product.is_active", "Active", "boolean", lambda row: row.is_active),
        _field(
            "product.sold_out",
            "Sold out override",
            "boolean",
            lambda row: row.sold_out_override,
        ),
        _field(
            "product.stock_cap", "Stock cap", "number", lambda row: row.total_stock_cap
        ),
        _field(
            "product.stock_remaining",
            "Stock remaining",
            "number",
            lambda row: row.total_stock_remaining,
        ),
        _field(
            "product.sale_starts_at",
            "Sale starts at",
            "datetime",
            lambda row: row.sale_starts_at,
        ),
        _field(
            "product.sale_ends_at",
            "Sale ends at",
            "datetime",
            lambda row: row.sale_ends_at,
        ),
        _field(
            "tickets.current_count",
            "Current ticket count",
            "number",
            lambda row: len(row.attendee_products),
        ),
        _field(
            "purchases.snapshot_count",
            "Purchased snapshot count",
            "number",
            lambda row: len(row.payment_products),
            "financial",
        ),
        _field(
            "purchases.snapshot_total",
            "Purchased snapshot total",
            "number",
            lambda row: sum(
                (
                    (
                        product.effective_unit_price
                        if product.effective_unit_price is not None
                        else product.product_price
                    )
                    * product.quantity
                    for product in row.payment_products
                ),
                Decimal("0"),
            ),
            "financial",
        ),
    ),
)


TICKETS = ExportDatasetDefinition(
    dataset="tickets",
    label="Tickets",
    description="Current first-class tickets enriched with attendee, human, application, product, and payment references.",
    scope="gathering",
    row_label="ticket",
    model=AttendeeProducts,
    popup_mode="attendee_join",
    option_factories=(
        lambda: selectinload(AttendeeProducts.attendee).selectinload(Attendees.human),
        lambda: selectinload(AttendeeProducts.attendee).selectinload(
            Attendees.application
        ),
        lambda: selectinload(AttendeeProducts.product),
    ),
    fields=(
        _field("ticket.id", "Ticket ID", "uuid", lambda row: row.id),
        _field(
            "ticket.payment_id",
            "Payment ID",
            "uuid",
            lambda row: row.payment_id,
            "financial",
        ),
        _field("attendee.id", "Attendee ID", "uuid", lambda row: row.attendee_id),
        _field(
            "attendee.name",
            "Attendee name",
            "string",
            lambda row: row.attendee.name if row.attendee else None,
            "pii",
        ),
        _field(
            "attendee.email",
            "Attendee email",
            "string",
            lambda row: row.attendee.email if row.attendee else None,
            "pii",
        ),
        _field(
            "application.id",
            "Application ID",
            "uuid",
            lambda row: row.attendee.application_id if row.attendee else None,
        ),
        _field(
            "application.status",
            "Application status",
            "string",
            lambda row: row.attendee.application.status
            if row.attendee and row.attendee.application
            else None,
        ),
        _field(
            "human.id",
            "Human ID",
            "uuid",
            lambda row: row.attendee.human_id if row.attendee else None,
        ),
        _field(
            "human.full_name",
            "Human name",
            "string",
            lambda row: _human_name(row.attendee.human) if row.attendee else None,
            "pii",
        ),
        _field(
            "human.email",
            "Human email",
            "string",
            lambda row: row.attendee.human.email
            if row.attendee and row.attendee.human
            else None,
            "pii",
        ),
        _field("product.id", "Product ID", "uuid", lambda row: row.product_id),
        _field(
            "product.name",
            "Product name",
            "string",
            lambda row: row.product.name if row.product else None,
        ),
        _field(
            "product.category",
            "Product category",
            "string",
            lambda row: row.product.category if row.product else None,
        ),
        _field(
            "product.price",
            "Current product price",
            "number",
            lambda row: row.product.price if row.product else None,
            "financial",
        ),
    ),
)


DATASETS: dict[str, ExportDatasetDefinition] = {
    definition.dataset: definition
    for definition in (APPLICATIONS, ATTENDEES, PAYMENTS, HUMANS, PRODUCTS, TICKETS)
}
