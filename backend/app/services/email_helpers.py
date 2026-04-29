"""Email dispatch helpers for application status transitions."""

from datetime import UTC, datetime

from sqlmodel import Session

from app.api.email_template.schemas import EmailTemplateType
from app.services.email import (
    ApplicationAcceptedContext,
    ApplicationAcceptedScholarshipRejectedContext,
    ApplicationAcceptedWithDiscountContext,
    ApplicationAcceptedWithIncentiveContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    get_email_service,
)

_AcceptedContext = (
    ApplicationAcceptedContext
    | ApplicationAcceptedWithDiscountContext
    | ApplicationAcceptedWithIncentiveContext
    | ApplicationAcceptedScholarshipRejectedContext
)


def _resolve_application_human_details(application, human) -> tuple[str, str, str]:
    source_human = application.human or human

    return (
        getattr(source_human, "first_name", None) or "",
        getattr(source_human, "last_name", None) or "",
        getattr(source_human, "email", None) or "",
    )


def _format_email_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None

    if value.tzinfo is not None:
        value = value.astimezone(UTC)
        return value.strftime("%B %d, %Y %H:%M UTC")

    return value.strftime("%B %d, %Y %H:%M")


def _get_scholarship_email_variant(
    application,
    popup,
) -> tuple[EmailTemplateType, _AcceptedContext]:
    """Determine the correct email template and context for an ACCEPTED application.

    This function is PURE — it reads only from the application and popup objects,
    performs no DB access, and has no side effects.

    Decision tree:
    1. scholarship_request=False → standard APPLICATION_ACCEPTED
    2. scholarship_request=True, scholarship_status=APPROVED, incentive_amount > 0
       → APPLICATION_ACCEPTED_WITH_INCENTIVE
    3. scholarship_request=True, scholarship_status=APPROVED, no incentive
       → APPLICATION_ACCEPTED_WITH_DISCOUNT
    4. scholarship_request=True, scholarship_status=REJECTED
       → APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED
    5. Fallback (pending/None — shouldn't happen post-decision) → standard APPLICATION_ACCEPTED
    """
    from app.api.application.schemas import ScholarshipStatus

    first_name = application.human.first_name or "" if application.human else ""
    last_name = application.human.last_name or "" if application.human else ""
    popup_name = popup.name

    if not application.scholarship_request:
        # Standard case — no scholarship involvement
        return (
            EmailTemplateType.APPLICATION_ACCEPTED,
            ApplicationAcceptedContext(
                first_name=first_name,
                last_name=last_name,
                popup_name=popup_name,
            ),
        )

    if application.scholarship_status == ScholarshipStatus.APPROVED.value:
        # Incentive path: popup must allow it AND incentive_amount must be > 0
        if (
            getattr(popup, "allows_incentive", False)
            and application.incentive_amount
            and application.incentive_amount > 0
        ):
            return (
                EmailTemplateType.APPLICATION_ACCEPTED_WITH_INCENTIVE,
                ApplicationAcceptedWithIncentiveContext(
                    first_name=first_name,
                    last_name=last_name,
                    popup_name=popup_name,
                    discount_percentage=int(application.discount_percentage or 0),
                    incentive_amount=float(application.incentive_amount),
                    incentive_currency=application.incentive_currency or "USD",
                ),
            )
        # Discount-only path
        return (
            EmailTemplateType.APPLICATION_ACCEPTED_WITH_DISCOUNT,
            ApplicationAcceptedWithDiscountContext(
                first_name=first_name,
                last_name=last_name,
                popup_name=popup_name,
                discount_percentage=int(application.discount_percentage or 0),
            ),
        )

    if application.scholarship_status == ScholarshipStatus.REJECTED.value:
        return (
            EmailTemplateType.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED,
            ApplicationAcceptedScholarshipRejectedContext(
                first_name=first_name,
                last_name=last_name,
                popup_name=popup_name,
            ),
        )

    # Fallback: scholarship requested but no decision yet (defensive — shouldn't
    # reach here in normal flow since email is sent after scholarship decision)
    return (
        EmailTemplateType.APPLICATION_ACCEPTED,
        ApplicationAcceptedContext(
            first_name=first_name,
            last_name=last_name,
            popup_name=popup_name,
        ),
    )


async def send_application_status_email(
    application,
    human,
    db: Session,
    status_before: str | None = None,
) -> None:
    """Send the appropriate email for an application status transition.

    If status_before is provided, only sends if status actually changed.
    If status_before is None (new application), always sends based on current status.
    """
    from app.api.application.schemas import ApplicationStatus

    current_status = application.status
    if status_before is not None and status_before == current_status:
        return

    popup = application.popup
    if not popup or not human:
        return

    first_name, last_name, email = _resolve_application_human_details(
        application, human
    )
    submitted_at = _format_email_datetime(getattr(application, "submitted_at", None))

    email_service = get_email_service()
    from_address = popup.tenant.sender_email if popup.tenant else None
    from_name = popup.tenant.sender_name if popup.tenant else None

    if current_status == ApplicationStatus.IN_REVIEW.value:
        await email_service.send_application_received(
            to=email,
            subject=f"Application Received for {popup.name}",
            context=ApplicationReceivedContext(
                first_name=first_name,
                last_name=last_name,
                email=email,
                popup_name=popup.name,
                submitted_at=submitted_at,
            ),
            from_address=from_address,
            from_name=from_name,
            popup_id=application.popup_id,
            db_session=db,
        )
    elif current_status == ApplicationStatus.ACCEPTED.value:
        template_type, context = _get_scholarship_email_variant(application, popup)

        if template_type == EmailTemplateType.APPLICATION_ACCEPTED:
            await email_service.send_application_accepted(
                to=email,
                subject=f"Application Accepted for {popup.name}",
                context=context,
                from_address=from_address,
                from_name=from_name,
                popup_id=application.popup_id,
                db_session=db,
            )
        elif template_type == EmailTemplateType.APPLICATION_ACCEPTED_WITH_DISCOUNT:
            await email_service.send_application_accepted_with_discount(
                to=email,
                subject=f"Your scholarship & application — {popup.name}",
                context=context,
                from_address=from_address,
                from_name=from_name,
                popup_id=application.popup_id,
                db_session=db,
            )
        elif template_type == EmailTemplateType.APPLICATION_ACCEPTED_WITH_INCENTIVE:
            await email_service.send_application_accepted_with_incentive(
                to=email,
                subject=f"Your scholarship award — {popup.name}",
                context=context,
                from_address=from_address,
                from_name=from_name,
                popup_id=application.popup_id,
                db_session=db,
            )
        elif (
            template_type == EmailTemplateType.APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED
        ):
            await email_service.send_application_accepted_scholarship_rejected(
                to=email,
                subject=f"Your application to {popup.name} — accepted",
                context=context,
                from_address=from_address,
                from_name=from_name,
                popup_id=application.popup_id,
                db_session=db,
            )
    elif current_status == ApplicationStatus.REJECTED.value:
        await email_service.send_application_rejected(
            to=email,
            subject=f"Application Update for {popup.name}",
            context=ApplicationRejectedContext(
                first_name=first_name,
                last_name=last_name,
                popup_name=popup.name,
            ),
            from_address=from_address,
            from_name=from_name,
            popup_id=application.popup_id,
            db_session=db,
        )
    # DRAFT, WITHDRAWN: no email
