from app.services.email.service import EmailService, get_email_service
from app.services.email.templates import (
    ApplicationAcceptedContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    EditPassesConfirmedContext,
    EmailTemplates,
    LoginCodeHumanContext,
    LoginCodeUserContext,
    PaymentAttendeeItem,
    PaymentConfirmedContext,
    PaymentPendingContext,
    PaymentProductItem,
)

__all__ = [
    "EmailService",
    "get_email_service",
    # Template name constants
    "EmailTemplates",
    # Auth contexts
    "LoginCodeUserContext",
    "LoginCodeHumanContext",
    # Application contexts
    "ApplicationReceivedContext",
    "ApplicationAcceptedContext",
    "ApplicationRejectedContext",
    # Payment contexts
    "PaymentConfirmedContext",
    "PaymentPendingContext",
    "EditPassesConfirmedContext",
    "PaymentProductItem",
    "PaymentAttendeeItem",
]
