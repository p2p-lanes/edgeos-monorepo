from app.services.email.service import (
    EmailAttachment,
    EmailService,
    compute_order_summary,
    get_email_service,
)
from app.services.email.templates import (
    AbandonedCartContext,
    ApplicationAcceptedContext,
    ApplicationAcceptedScholarshipRejectedContext,
    ApplicationAcceptedWithDiscountContext,
    ApplicationAcceptedWithIncentiveContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    EditPassesConfirmedContext,
    EmailTemplates,
    EventApprovalApprovedContext,
    EventApprovalRejectedContext,
    EventInvitationContext,
    LoginCodeHumanContext,
    LoginCodeUserContext,
    PaymentAttendeeItem,
    PaymentConfirmedContext,
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
    "ApplicationAcceptedWithDiscountContext",
    "ApplicationAcceptedWithIncentiveContext",
    "ApplicationAcceptedScholarshipRejectedContext",
    # Payment contexts
    "PaymentConfirmedContext",
    "AbandonedCartContext",
    "EditPassesConfirmedContext",
    "PaymentProductItem",
    "PaymentAttendeeItem",
    # Event contexts
    "EventInvitationContext",
    "EventApprovalApprovedContext",
    "EventApprovalRejectedContext",
    # Helpers
    "compute_order_summary",
    "EmailAttachment",
]
