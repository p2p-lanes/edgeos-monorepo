"""
Type-safe email template context definitions.

Each Pydantic model defines the expected variables for a specific email template.
Use these types when calling EmailService.send_template_email() for IDE autocomplete.
"""

from pydantic import BaseModel

# =============================================================================
# Auth Templates
# =============================================================================


class LoginCodeUserContext(BaseModel):
    """Context for auth/login_code_user.html template.

    Used for backoffice user login verification.
    """

    user_name: str | None = None
    auth_code: str
    expiration_minutes: int = 15


class LoginCodeHumanContext(BaseModel):
    """Context for auth/login_code_human.html template.

    Used for portal/attendee login verification.
    """

    first_name: str | None = None
    auth_code: str
    expiration_minutes: int = 15


# =============================================================================
# Application Templates
# =============================================================================


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
    payment_deadline: str | None = None
    discount_assigned: int | None = None
    portal_url: str | None = None


class ApplicationRejectedContext(BaseModel):
    """Context for application/rejected.html template.

    Sent when an application is not accepted.
    """

    first_name: str
    last_name: str
    popup_name: str


# =============================================================================
# Payment Templates
# =============================================================================


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
    portal_url: str | None = None


class PaymentPendingContext(BaseModel):
    """Context for payment/pending.html template.

    Sent when a payment is created but not yet completed.
    """

    first_name: str
    popup_name: str
    amount: float
    currency: str
    products: list[PaymentProductItem] | None = None
    discount_value: int | None = None
    original_amount: float | None = None
    checkout_url: str | None = None


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
    portal_url: str | None = None


# =============================================================================
# Template Name Constants
# =============================================================================


class EmailTemplates:
    """Constants for email template names.

    Use these constants instead of hardcoding template paths.
    """

    # Auth
    LOGIN_CODE_USER = "auth/login_code_user.html"
    LOGIN_CODE_HUMAN = "auth/login_code_human.html"

    # Application
    APPLICATION_RECEIVED = "application/received.html"
    APPLICATION_ACCEPTED = "application/accepted.html"
    APPLICATION_REJECTED = "application/rejected.html"

    # Payment
    PAYMENT_CONFIRMED = "payment/confirmed.html"
    PAYMENT_PENDING = "payment/pending.html"
    EDIT_PASSES_CONFIRMED = "payment/edit_passes_confirmed.html"
