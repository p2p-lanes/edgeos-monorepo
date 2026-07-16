import datetime
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, Undefined
from jinja2.sandbox import SandboxedEnvironment
from loguru import logger
from pydantic import BaseModel

from app.api.email_template.schemas import EmailTemplateType, TemplateScope


class LoginCodeUserContext(BaseModel):
    """Context for auth/login_code_user.html template.

    Used for backoffice user login verification.
    """

    user_name: str | None = None
    tenant_name: str | None = None
    auth_code: str
    expiration_minutes: int = 15


class LoginCodeHumanContext(BaseModel):
    """Context for auth/login_code_human.html template.

    Used for portal/attendee login verification.
    """

    first_name: str | None = None
    tenant_name: str | None = None
    auth_code: str
    expiration_minutes: int = 15


class ApplicationReceivedContext(BaseModel):
    """Context for application/received.html template.

    Sent when an application is submitted for review.
    """

    first_name: str
    last_name: str
    email: str
    popup_name: str
    submitted_at: str | None = None
    portal_url: str | None = None


class ApplicationAcceptedContext(BaseModel):
    """Context for application/accepted.html template.

    Sent when an application is accepted.
    """

    first_name: str
    last_name: str
    popup_name: str
    portal_url: str | None = None
    passes_url: str | None = None


class ApplicationRejectedContext(BaseModel):
    """Context for application/rejected.html template.

    Sent when an application is not accepted.
    """

    first_name: str
    last_name: str
    popup_name: str


class ApplicationAcceptedWithDiscountContext(BaseModel):
    """Context for application/accepted_with_discount.html template.

    Sent when an application is accepted and a scholarship discount (no cash
    incentive) was approved. The discount may be partial or full (100%).
    """

    first_name: str
    last_name: str
    popup_name: str
    discount_percentage: int  # e.g. 50 = "50% off", 100 = "full waiver"
    portal_url: str | None = None
    passes_url: str | None = None


class ApplicationAcceptedWithIncentiveContext(BaseModel):
    """Context for application/accepted_with_incentive.html template.

    Sent when an application is accepted with both a scholarship discount
    and a cash incentive grant.
    """

    first_name: str
    last_name: str
    popup_name: str
    discount_percentage: int  # ticket discount percentage
    incentive_amount: float  # e.g. 1000.00
    incentive_currency: str  # e.g. "USD"
    portal_url: str | None = None
    passes_url: str | None = None


class ApplicationAcceptedScholarshipRejectedContext(BaseModel):
    """Context for application/accepted_scholarship_rejected.html template.

    Sent when an application is accepted but the scholarship request was
    not approved. The human may still purchase at the standard price.
    """

    first_name: str
    last_name: str
    popup_name: str
    portal_url: str | None = None
    passes_url: str | None = None


class PaymentProductItem(BaseModel):
    """Product item for payment email templates."""

    name: str
    price: float
    quantity: int


class PaymentAttendeeItem(BaseModel):
    """Attendee item for payment email templates."""

    name: str
    category: str
    products: list[PaymentProductItem] | None = None


class PaymentConfirmedContext(BaseModel):
    """Context for payment/confirmed.html template.

    Sent when a payment is successfully processed.
    """

    first_name: str
    popup_name: str
    payment_id: str
    amount: float
    currency: str
    products: list[PaymentProductItem] | None = None
    discount_value: int | None = None
    original_amount: float | None = None
    attendees: list[PaymentAttendeeItem] | None = None
    order_summary: str | None = None
    portal_url: str | None = None


class AbandonedCartContext(BaseModel):
    """Context for payment/abandoned_cart.html template.

    Sent when a payment is created but not completed (abandoned cart).
    """

    first_name: str
    popup_name: str
    amount: float
    currency: str
    products: list[PaymentProductItem] | None = None
    discount_value: int | None = None
    original_amount: float | None = None
    checkout_url: str | None = None
    order_summary: str | None = None


class EditPassesConfirmedContext(BaseModel):
    """Context for payment/edit_passes_confirmed.html template.

    Sent when pass modifications are processed.
    """

    first_name: str
    popup_name: str
    payment_id: str
    amount: float
    currency: str
    products: list[PaymentProductItem] | None = None
    credit_applied: float | None = None
    remaining_credit: float | None = None
    attendees: list[PaymentAttendeeItem] | None = None
    order_summary: str | None = None
    portal_url: str | None = None


class EventInvitationContext(BaseModel):
    """Context for event/invitation.html template.

    Used for organiser-side invitations and self-RSVP confirmations.
    Update/cancel flows have their own dedicated templates.
    """

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    # Pre-formatted time range like "May 5, 2026 at 14:00 – 15:00" in the
    # event's display TZ. Falls back to start-only when no end is known.
    event_when: str = ""
    venue_title: str = ""
    event_url: str = ""


class EventChangeRow(BaseModel):
    """Before/after pair surfaced as an inline diff in update emails."""

    before: str
    after: str


class EventUpdatedContext(BaseModel):
    """Context for event/updated.html — change notification with before/after diff."""

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    event_when: str = ""
    venue_title: str = ""
    event_url: str = ""
    changes: dict[str, EventChangeRow] = {}


class EventCancelledContext(BaseModel):
    """Context for event/cancelled.html — cancellation notice."""

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    event_when: str = ""
    venue_title: str = ""


class EventRsvpCancelledContext(BaseModel):
    """Context for event/rsvp_cancelled.html — self-service RSVP cancellation.

    Sent when a human cancels their own registration. The event itself is not
    cancelled, so the copy confirms the registration was removed rather than
    announcing an event cancellation.
    """

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    event_when: str = ""
    venue_title: str = ""
    event_url: str = ""


class EventApprovalApprovedContext(BaseModel):
    """Context for event/approval_approved.html template.

    Sent to the event creator when an admin approves a venue-approval-required event.
    """

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    event_when: str = ""
    venue_title: str = ""
    event_url: str = ""
    reason: str = ""


class EventApprovalRejectedContext(BaseModel):
    """Context for event/approval_rejected.html template.

    Sent to the event creator when an admin rejects the event request.
    """

    first_name: str = ""
    event_title: str
    popup_name: str = ""
    event_when: str = ""
    venue_title: str = ""
    reason: str = ""


class CheckInQrItem(BaseModel):
    """A single check-in QR entry for the check-in pass email.

    One per scannable ticket (``AttendeeProducts`` row where the product has
    ``requires_check_in``). ``qr_url`` points at the hosted PNG; it may be
    ``None`` if storage is unavailable when the email is built.
    """

    attendee_name: str
    product_name: str
    check_in_code: str
    qr_url: str | None = None


class CheckInPassContext(BaseModel):
    """Context for check_in/pass.html template.

    Sent on a schedule before the popup start_date to the buyer, carrying the
    check-in QR codes for every scannable ticket they purchased.
    """

    first_name: str
    popup_name: str = ""
    # One entry per scannable ticket. Loop over this in the template.
    checkin_qrs: list[CheckInQrItem] = []
    # Convenience for the common single-ticket case: the first ticket's QR URL.
    checkin_qr_url: str | None = None
    portal_url: str | None = None


class TrialWelcomeContext(BaseModel):
    """Context for auth/trial_welcome.html template.

    Sent right after a self-serve trial is provisioned, with the onboarding
    checklist.
    """

    gathering_name: str
    backoffice_url: str
    trial_days: int = 7


class TrialReminderContext(BaseModel):
    """Context for auth/trial_reminder.html template.

    Sent once when a trial has 2 days or less remaining.
    """

    gathering_name: str
    backoffice_url: str
    expires_on: str  # human-readable date, e.g. "July 22, 2026"


class TrialEndedContext(BaseModel):
    """Context for auth/trial_ended.html template.

    Sent once when a trial expires and the tenant is suspended.
    Data is retained — the copy invites the organizer to talk to us.
    """

    gathering_name: str


class EmailTemplates:
    # Auth
    LOGIN_CODE_USER = "auth/login_code_user.html"
    LOGIN_CODE_HUMAN = "auth/login_code_human.html"

    # Self-serve trials
    TRIAL_WELCOME = "auth/trial_welcome.html"
    TRIAL_REMINDER = "auth/trial_reminder.html"
    TRIAL_ENDED = "auth/trial_ended.html"

    # Application
    APPLICATION_RECEIVED = "application/received.html"
    APPLICATION_ACCEPTED = "application/accepted.html"
    APPLICATION_REJECTED = "application/rejected.html"
    APPLICATION_ACCEPTED_WITH_DISCOUNT = "application/accepted_with_discount.html"
    APPLICATION_ACCEPTED_WITH_INCENTIVE = "application/accepted_with_incentive.html"
    APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED = (
        "application/accepted_scholarship_rejected.html"
    )

    # Payment
    PAYMENT_CONFIRMED = "payment/confirmed.html"
    ABANDONED_CART = "payment/abandoned_cart.html"
    EDIT_PASSES_CONFIRMED = "payment/edit_passes_confirmed.html"

    # Event
    EVENT_INVITATION = "event/invitation.html"
    EVENT_UPDATED = "event/updated.html"
    EVENT_CANCELLED = "event/cancelled.html"
    EVENT_RSVP_CANCELLED = "event/rsvp_cancelled.html"
    EVENT_APPROVAL_APPROVED = "event/approval_approved.html"
    EVENT_APPROVAL_REJECTED = "event/approval_rejected.html"

    # Check-in
    CHECK_IN_PASS = "check_in/pass.html"


TEMPLATE_TYPE_TO_FILE: dict[EmailTemplateType, str] = {
    EmailTemplateType.LOGIN_CODE_USER: "auth/login_code_user.html",
    EmailTemplateType.LOGIN_CODE_HUMAN: "auth/login_code_human.html",
    EmailTemplateType.APPLICATION_RECEIVED: "application/received.html",
    EmailTemplateType.APPLICATION_ACCEPTED: "application/accepted.html",
    EmailTemplateType.APPLICATION_REJECTED: "application/rejected.html",
    EmailTemplateType.APPLICATION_ACCEPTED_WITH_DISCOUNT: "application/accepted_with_discount.html",
    EmailTemplateType.APPLICATION_ACCEPTED_WITH_INCENTIVE: "application/accepted_with_incentive.html",
    EmailTemplateType.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED: "application/accepted_scholarship_rejected.html",
    EmailTemplateType.PAYMENT_CONFIRMED: "payment/confirmed.html",
    EmailTemplateType.ABANDONED_CART: "payment/abandoned_cart.html",
    EmailTemplateType.EDIT_PASSES_CONFIRMED: "payment/edit_passes_confirmed.html",
    EmailTemplateType.EVENT_INVITATION: "event/invitation.html",
    EmailTemplateType.EVENT_UPDATED: "event/updated.html",
    EmailTemplateType.EVENT_CANCELLED: "event/cancelled.html",
    EmailTemplateType.EVENT_RSVP_CANCELLED: "event/rsvp_cancelled.html",
    EmailTemplateType.EVENT_APPROVAL_APPROVED: "event/approval_approved.html",
    EmailTemplateType.EVENT_APPROVAL_REJECTED: "event/approval_rejected.html",
    EmailTemplateType.CHECK_IN_PASS: "check_in/pass.html",
}


_POPUP_EVENT_VARIABLES: list[dict[str, Any]] = [
    {
        "name": "popup_name",
        "label": "Name",
        "type": "string",
        "description": "Name of the event/popup",
        "required": True,
        "group": "Event",
    },
    {
        "name": "popup_image_url",
        "label": "Cover Image URL",
        "type": "string",
        "description": "Event cover image URL",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_icon_url",
        "label": "Icon URL",
        "type": "string",
        "description": "Event icon/logo URL",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_web_url",
        "label": "Website URL",
        "type": "string",
        "description": "Event website URL",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_blog_url",
        "label": "Blog URL",
        "type": "string",
        "description": "Event blog URL",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_twitter_url",
        "label": "Twitter/X URL",
        "type": "string",
        "description": "Event Twitter/X URL",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_start_date",
        "label": "Start Date",
        "type": "string",
        "description": "Event start date",
        "required": False,
        "group": "Event",
    },
    {
        "name": "popup_end_date",
        "label": "End Date",
        "type": "string",
        "description": "Event end date",
        "required": False,
        "group": "Event",
    },
]

TENANT_SCOPED_TEMPLATE_TYPES = {
    EmailTemplateType.LOGIN_CODE_HUMAN,
}


def coerce_email_template_type(
    template_type: EmailTemplateType | str,
) -> EmailTemplateType:
    return (
        template_type
        if isinstance(template_type, EmailTemplateType)
        else EmailTemplateType(template_type)
    )


def get_template_scope(template_type: EmailTemplateType | str) -> TemplateScope:
    return (
        TemplateScope.TENANT
        if coerce_email_template_type(template_type) in TENANT_SCOPED_TEMPLATE_TYPES
        else TemplateScope.POPUP
    )


AUTH_TEMPLATE_METADATA: list[dict[str, Any]] = [
    {
        "type": EmailTemplateType.LOGIN_CODE_HUMAN,
        "label": "Portal Login Code",
        "description": "Verification email sent to portal users during sign in.",
        "category": "Auth",
        "scope": TemplateScope.TENANT,
        "default_subject": "Your Verification Code - {{ tenant_name or project_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Portal user's first name",
                "required": False,
                "group": "Recipient",
            },
            {
                "name": "tenant_name",
                "label": "Tenant Name",
                "type": "string",
                "description": "Tenant or organization name",
                "required": False,
                "group": "General",
            },
            {
                "name": "auth_code",
                "label": "Authentication Code",
                "type": "string",
                "description": "One-time login code",
                "required": True,
                "group": "General",
            },
            {
                "name": "expiration_minutes",
                "label": "Expiration Minutes",
                "type": "number",
                "description": "How long the code remains valid",
                "required": True,
                "group": "General",
            },
        ],
    },
]


POPUP_TEMPLATE_METADATA: list[dict[str, Any]] = [
    # NOTE: Login code templates (LOGIN_CODE_USER, LOGIN_CODE_HUMAN) are excluded
    # because they have no popup context during auth flow and always use file-based defaults.
    {
        "type": EmailTemplateType.APPLICATION_RECEIVED,
        "label": "Application Received",
        "description": "Confirmation sent when an application is submitted.",
        "category": "Application",
        "default_subject": "Application Received for {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "email",
                "label": "Email",
                "type": "string",
                "description": "Applicant's email address",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "submitted_at",
                "label": "Submitted At",
                "type": "string",
                "description": "Submission date/time",
                "required": False,
                "group": "General",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.APPLICATION_ACCEPTED,
        "label": "Application Accepted",
        "description": "Sent when an application is approved.",
        "category": "Application",
        "default_subject": "Application Accepted - {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            {
                "name": "passes_url",
                "label": "Passes URL",
                "type": "string",
                "description": "Deep link to this popup's passes page",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.APPLICATION_REJECTED,
        "label": "Application Rejected",
        "description": "Sent when an application is not accepted.",
        "category": "Application",
        "default_subject": "Application Update - {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.APPLICATION_ACCEPTED_WITH_DISCOUNT,
        "label": "Application Accepted — Scholarship Discount",
        "description": "Sent when an application is accepted with a scholarship discount (no cash incentive).",
        "category": "Application",
        "default_subject": "Your scholarship & application — {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "discount_percentage",
                "label": "Discount Percentage",
                "type": "number",
                "description": "Scholarship discount percentage (e.g. 100 = full ticket waiver)",
                "required": True,
                "group": "Scholarship",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            {
                "name": "passes_url",
                "label": "Passes URL",
                "type": "string",
                "description": "Deep link to this popup's passes page",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.APPLICATION_ACCEPTED_WITH_INCENTIVE,
        "label": "Application Accepted — Scholarship + Incentive",
        "description": "Sent when an application is accepted with both a scholarship discount and a cash grant.",
        "category": "Application",
        "default_subject": "Your scholarship award — {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "discount_percentage",
                "label": "Discount Percentage",
                "type": "number",
                "description": "Scholarship discount percentage",
                "required": True,
                "group": "Scholarship",
            },
            {
                "name": "incentive_amount",
                "label": "Incentive Amount",
                "type": "number",
                "description": "Cash grant amount (e.g. 1000.00)",
                "required": True,
                "group": "Scholarship",
            },
            {
                "name": "incentive_currency",
                "label": "Incentive Currency",
                "type": "string",
                "description": "ISO currency code for the grant (e.g. USD)",
                "required": True,
                "group": "Scholarship",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            {
                "name": "passes_url",
                "label": "Passes URL",
                "type": "string",
                "description": "Deep link to this popup's passes page",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED,
        "label": "Application Accepted — Scholarship Not Approved",
        "description": "Sent when an application is accepted but the scholarship request was denied.",
        "category": "Application",
        "default_subject": "Your application to {{ popup_name }} — accepted",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Applicant's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "last_name",
                "label": "Last Name",
                "type": "string",
                "description": "Applicant's last name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            {
                "name": "passes_url",
                "label": "Passes URL",
                "type": "string",
                "description": "Deep link to this popup's passes page",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.PAYMENT_CONFIRMED,
        "label": "Payment Confirmed",
        "description": "Sent when a payment is successfully processed.",
        "category": "Payment",
        "default_subject": "Payment Confirmed - {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Payer's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "payment_id",
                "label": "Payment ID",
                "type": "string",
                "description": "Payment reference ID",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "amount",
                "label": "Amount",
                "type": "number",
                "description": "Total amount paid",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "currency",
                "label": "Currency",
                "type": "string",
                "description": "Payment currency (e.g., USD)",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "products",
                "label": "Products",
                "type": "array",
                "description": "List of purchased products",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "discount_value",
                "label": "Discount %",
                "type": "number",
                "description": "Discount percentage applied",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "original_amount",
                "label": "Original Amount",
                "type": "number",
                "description": "Amount before discount",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "attendees",
                "label": "Attendees",
                "type": "array",
                "description": "List of attendees covered",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "order_summary",
                "label": "Order Summary",
                "type": "string",
                "description": "Pre-rendered HTML summary of products and attendees",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.ABANDONED_CART,
        "label": "Abandoned Cart",
        "description": "Sent when a payment is created but not completed (abandoned cart).",
        "category": "Payment",
        "default_subject": "Complete Your Purchase - {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Payer's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "amount",
                "label": "Amount",
                "type": "number",
                "description": "Total amount due",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "currency",
                "label": "Currency",
                "type": "string",
                "description": "Payment currency (e.g., USD)",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "products",
                "label": "Products",
                "type": "array",
                "description": "List of products",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "discount_value",
                "label": "Discount %",
                "type": "number",
                "description": "Discount percentage applied",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "original_amount",
                "label": "Original Amount",
                "type": "number",
                "description": "Amount before discount",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "order_summary",
                "label": "Order Summary",
                "type": "string",
                "description": "Pre-rendered HTML summary of products and attendees",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "checkout_url",
                "label": "Checkout URL",
                "type": "string",
                "description": "Link to complete payment",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EDIT_PASSES_CONFIRMED,
        "label": "Pass Edit Confirmed",
        "description": "Sent when pass modifications are processed.",
        "category": "Payment",
        "default_subject": "Pass Changes Confirmed - {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Attendee's first name",
                "required": True,
                "group": "Applicant",
            },
            {
                "name": "payment_id",
                "label": "Payment ID",
                "type": "string",
                "description": "Payment reference ID",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "amount",
                "label": "Amount",
                "type": "number",
                "description": "New total amount",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "currency",
                "label": "Currency",
                "type": "string",
                "description": "Payment currency (e.g., USD)",
                "required": True,
                "group": "Payment",
            },
            {
                "name": "products",
                "label": "Products",
                "type": "array",
                "description": "Updated product list",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "credit_applied",
                "label": "Credit Applied",
                "type": "number",
                "description": "Credit applied from previous payment",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "remaining_credit",
                "label": "Remaining Credit",
                "type": "number",
                "description": "Remaining credit balance",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "attendees",
                "label": "Attendees",
                "type": "array",
                "description": "Updated attendee list",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "order_summary",
                "label": "Order Summary",
                "type": "string",
                "description": "Pre-rendered HTML summary of products and attendees",
                "required": False,
                "group": "Payment",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_INVITATION,
        "label": "Event Invitation",
        "description": "Sent when a human is invited to a private or unlisted event.",
        "category": "Event",
        "default_subject": "You're invited to {{ event_title }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Recipient's first name",
                "required": False,
                "group": "Recipient",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name (may be empty)",
                "required": False,
                "group": "Event",
            },
            {
                "name": "event_url",
                "label": "Event URL",
                "type": "string",
                "description": "Deep link to the event page in the portal",
                "required": False,
                "group": "Event",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_UPDATED,
        "label": "Event Updated",
        "description": "Sent when an event the recipient is invited to or RSVPd to is updated.",
        "category": "Event",
        "default_subject": "The event has been updated: {{ event_title }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Recipient's first name",
                "required": False,
                "group": "Recipient",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name (may be empty)",
                "required": False,
                "group": "Event",
            },
            {
                "name": "event_url",
                "label": "Event URL",
                "type": "string",
                "description": "Deep link to the event page in the portal",
                "required": False,
                "group": "Event",
            },
            {
                "name": "changes",
                "label": "Changes",
                "type": "object",
                "description": "Mapping from row key ('event', 'time', 'location') to {before, after} describing what changed",
                "required": False,
                "group": "Event",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_CANCELLED,
        "label": "Event Cancelled",
        "description": "Sent when an event the recipient is invited to or RSVPd to is cancelled.",
        "category": "Event",
        "default_subject": "Event cancelled: {{ event_title }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Recipient's first name",
                "required": False,
                "group": "Recipient",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name (may be empty)",
                "required": False,
                "group": "Event",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_RSVP_CANCELLED,
        "label": "Registration Cancelled",
        "description": "Sent to a recipient who cancels their own registration to an event.",
        "category": "Event",
        "default_subject": "Your registration was cancelled: {{ event_title }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Recipient's first name",
                "required": False,
                "group": "Recipient",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name (may be empty)",
                "required": False,
                "group": "Event",
            },
            {
                "name": "event_url",
                "label": "Event URL",
                "type": "string",
                "description": "Link back to the event in the portal",
                "required": False,
                "group": "Event",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_APPROVAL_APPROVED,
        "label": "Event Approved",
        "description": "Sent to the event creator when an admin approves their request.",
        "category": "Event",
        "default_subject": 'Your event "{{ event_title }}" was approved',
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Creator's first name",
                "required": False,
                "group": "Creator",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name",
                "required": False,
                "group": "Event",
            },
            {
                "name": "event_url",
                "label": "Event URL",
                "type": "string",
                "description": "Deep link to the event page",
                "required": False,
                "group": "Event",
            },
            {
                "name": "reason",
                "label": "Reason",
                "type": "string",
                "description": "Optional note from the admin",
                "required": False,
                "group": "Decision",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.EVENT_APPROVAL_REJECTED,
        "label": "Event Rejected",
        "description": "Sent to the event creator when an admin rejects their request.",
        "category": "Event",
        "default_subject": 'Your event "{{ event_title }}" was not approved',
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Creator's first name",
                "required": False,
                "group": "Creator",
            },
            {
                "name": "event_title",
                "label": "Event Title",
                "type": "string",
                "description": "Title of the event",
                "required": True,
                "group": "Event",
            },
            {
                "name": "event_when",
                "label": "When",
                "type": "string",
                "description": "Formatted start date/time",
                "required": False,
                "group": "Event",
            },
            {
                "name": "venue_title",
                "label": "Venue",
                "type": "string",
                "description": "Venue name",
                "required": False,
                "group": "Event",
            },
            {
                "name": "reason",
                "label": "Reason",
                "type": "string",
                "description": "Optional explanation from the admin",
                "required": False,
                "group": "Decision",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
    {
        "type": EmailTemplateType.CHECK_IN_PASS,
        "label": "Check-in Pass",
        "description": (
            "Sent on a schedule before the event with the attendee's check-in "
            "QR code(s). Sent to the buyer with all the check-in codes they "
            "purchased."
        ),
        "category": "Check-in",
        "default_subject": "Your check-in pass for {{ popup_name }}",
        "variables": [
            {
                "name": "first_name",
                "label": "First Name",
                "type": "string",
                "description": "Buyer's first name",
                "required": True,
                "group": "Recipient",
            },
            {
                "name": "checkin_qrs",
                "label": "Check-in QR codes",
                "type": "array",
                "description": (
                    "One entry per scannable ticket, each with attendee_name, "
                    "product_name, check_in_code and qr_url. Loop over this."
                ),
                "required": False,
                "group": "Check-in",
            },
            {
                "name": "checkin_qr_url",
                "label": "Check-in QR URL (first ticket)",
                "type": "string",
                "description": (
                    "Convenience for the single-ticket case: the hosted QR "
                    "image URL for the first ticket."
                ),
                "required": False,
                "group": "Check-in",
            },
            {
                "name": "portal_url",
                "label": "Portal URL",
                "type": "string",
                "description": "Link to the attendee portal",
                "required": False,
                "group": "General",
            },
            *_POPUP_EVENT_VARIABLES,
        ],
    },
]


def validate_template_variables(
    template_type: EmailTemplateType, context: dict[str, Any]
) -> list[str]:
    """Return names of required variables missing from *context*.

    Looks up ``TEMPLATE_TYPE_METADATA`` for *template_type* and checks that
    every variable marked ``required=True`` is present (and not ``None``) in
    *context*.

    Returns an empty list when:
    - all required variables are present, **or**
    - *template_type* has no metadata entry (e.g. login-code templates).
    """
    metadata = next(
        (m for m in TEMPLATE_TYPE_METADATA if m["type"] == template_type), None
    )
    if metadata is None:
        return []

    required_names = [
        var["name"] for var in metadata["variables"] if var.get("required")
    ]
    return [name for name in required_names if context.get(name) is None]


def log_missing_template_variables(
    template_type: EmailTemplateType, context: dict[str, Any]
) -> None:
    """Validate required template variables and log a warning if any are missing."""
    missing = validate_template_variables(template_type, context)
    if missing:
        logger.warning(
            "Missing required template variables for {}: {}",
            template_type.value,
            ", ".join(missing),
        )


class SilentUndefined(Undefined):
    """Permissive Undefined that renders missing variables as empty strings.

    Used in production email rendering so that a missing variable never
    prevents the email from being sent.  Instead of raising
    ``UndefinedError``, each access silently resolves:

    * ``{{ missing_var }}`` → ``""``
    * ``{% if missing_var %}`` → ``False``
    * ``{% for x in missing_var %}`` → zero iterations
    """

    def _fail_with_undefined_error(self, *args, **kwargs):  # type: ignore[override]
        return ""

    def __str__(self) -> str:
        return ""

    def __iter__(self):
        return iter([])

    def __bool__(self) -> bool:
        return False


class PreservingUndefined(Undefined):
    """Custom Undefined that preserves Jinja2 variable syntax as {{ var_name }}.

    Used during template flattening and live preview to resolve inheritance/includes
    while keeping variables as editable placeholders.

    Handles arithmetic, string concatenation, and format filters so that
    complex template expressions (``original_amount - amount``,
    ``' ' + user_name``, ``"%.2f"|format(value)``) don't crash.
    """

    def __str__(self) -> str:
        name: str = self._undefined_name  # type: ignore[assignment]
        return "{{ " + name + " }}"

    def __iter__(self):
        return iter([])

    def __bool__(self) -> bool:
        return True

    def __getattr__(self, name: str) -> "PreservingUndefined":
        return PreservingUndefined(name=f"{self._undefined_name}.{name}")

    # String concatenation: ' ' + user_name → ' {{ user_name }}'
    def __add__(self, other: object) -> str:
        return str(self) + str(other)

    def __radd__(self, other: object) -> str:
        return str(other) + str(self)

    # Arithmetic — return 0 so expressions like `original_amount - amount`
    # resolve to a number that downstream filters (e.g. "%.2f"|format) can use.
    def __sub__(self, other: object) -> int:
        return 0

    def __rsub__(self, other: object) -> int:
        return 0

    def __mul__(self, other: object) -> int:
        return 0

    def __rmul__(self, other: object) -> int:
        return 0

    # Comparisons — return True so {% if amount > 0 %} blocks render
    def __gt__(self, other: object) -> bool:
        return True

    def __lt__(self, other: object) -> bool:
        return True

    def __ge__(self, other: object) -> bool:
        return True

    def __le__(self, other: object) -> bool:
        return True

    def __eq__(self, other: object) -> bool:
        return False

    def __ne__(self, other: object) -> bool:
        return True

    # For "%.2f"|format(value) — Python's % formatting calls float()
    def __float__(self) -> float:
        return 0.0

    def __int__(self) -> int:
        return 0


def flatten_template(template_type: EmailTemplateType) -> str:
    """Resolve template inheritance into a self-contained HTML document.

    Resolves {% extends %} and {% include %} but preserves {{ variable }}
    placeholders so users can edit them in the Monaco editor.

    Templates that are already self-contained (no inheritance) are returned
    verbatim — rendering them would *execute* their control structures, e.g.
    dropping a ``{% for %}`` loop over data that isn't present at flatten time
    (the check-in pass QR loop). Returning the raw source keeps those loops.
    """
    from app.core.config import settings

    template_dir = Path("app/templates/emails")
    file_path = TEMPLATE_TYPE_TO_FILE[template_type]

    source = (template_dir / file_path).read_text(encoding="utf-8")
    if "{% extends" not in source and "{% include" not in source:
        return source

    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        undefined=PreservingUndefined,
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.globals.update(
        {
            "project_name": settings.PROJECT_NAME,
            "current_year": datetime.datetime.now().year,
        }
    )

    template = env.get_template(file_path)
    return template.render()


TEMPLATE_TYPE_METADATA: list[dict[str, Any]] = [
    *AUTH_TEMPLATE_METADATA,
    *[{**meta, "scope": TemplateScope.POPUP} for meta in POPUP_TEMPLATE_METADATA],
]

CUSTOMIZABLE_TEMPLATE_TYPES = {meta["type"] for meta in TEMPLATE_TYPE_METADATA}


def is_customizable_template_type(template_type: EmailTemplateType | str) -> bool:
    return coerce_email_template_type(template_type) in CUSTOMIZABLE_TEMPLATE_TYPES


def render_default_subject(
    template_type: EmailTemplateType | str,
    context: Mapping[str, Any],
) -> str:
    """Render the metadata ``default_subject`` for *template_type* against *context*.

    Single source of truth for the default subject used when a popup has no
    custom template (or its custom template has no subject override). Keeps the
    English default colocated with the rest of the template metadata instead of
    hardcoded at each caller.
    """
    coerced = coerce_email_template_type(template_type)
    meta = next((m for m in TEMPLATE_TYPE_METADATA if m["type"] == coerced), None)
    if meta is None:
        return ""
    env = SandboxedEnvironment(undefined=SilentUndefined)
    return env.from_string(meta["default_subject"]).render(**context)
