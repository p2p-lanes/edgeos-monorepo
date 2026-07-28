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
    CheckInPassContext,
    CheckInQrItem,
    EditPassesConfirmedContext,
    EmailTemplates,
    EventApprovalApprovedContext,
    EventApprovalRejectedContext,
    EventCancelledContext,
    EventInvitationContext,
    EventRsvpCancelledContext,
    EventUpdatedContext,
    LoginCodeHumanContext,
    LoginCodeUserContext,
    PaymentAttendeeItem,
    PaymentConfirmedContext,
    PaymentProductItem,
    TrialEndedContext,
    TrialReminderContext,
    TrialWelcomeContext,
)

__all__ = [
    "EmailService",
    "get_email_service",
    # Template name constants
    "EmailTemplates",
    # Auth contexts
    "LoginCodeUserContext",
    "LoginCodeHumanContext",
    # Trial contexts
    "TrialWelcomeContext",
    "TrialReminderContext",
    "TrialEndedContext",
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
    "EventUpdatedContext",
    "EventCancelledContext",
    "EventRsvpCancelledContext",
    "EventApprovalApprovedContext",
    "EventApprovalRejectedContext",
    # Check-in contexts
    "CheckInPassContext",
    "CheckInQrItem",
    # Helpers
    "compute_order_summary",
    "EmailAttachment",
]
