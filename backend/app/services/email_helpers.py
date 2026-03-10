"""Email dispatch helpers for application status transitions."""
from sqlmodel import Session

from app.services.email import (
    ApplicationAcceptedContext,
    ApplicationReceivedContext,
    ApplicationRejectedContext,
    get_email_service,
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

    email_service = get_email_service()
    from_address = popup.tenant.sender_email if popup.tenant else None
    from_name = popup.tenant.sender_name if popup.tenant else None

    if current_status == ApplicationStatus.IN_REVIEW.value:
        await email_service.send_application_received(
            to=human.email,
            subject=f"Application Received for {popup.name}",
            context=ApplicationReceivedContext(
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                email=human.email,
                popup_name=popup.name,
            ),
            from_address=from_address,
            from_name=from_name,
            popup_id=application.popup_id,
            db_session=db,
        )
    elif current_status == ApplicationStatus.ACCEPTED.value:
        await email_service.send_application_accepted(
            to=human.email,
            subject=f"Application Accepted for {popup.name}",
            context=ApplicationAcceptedContext(
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                popup_name=popup.name,
            ),
            from_address=from_address,
            from_name=from_name,
            popup_id=application.popup_id,
            db_session=db,
        )
    elif current_status == ApplicationStatus.REJECTED.value:
        await email_service.send_application_rejected(
            to=human.email,
            subject=f"Application Update for {popup.name}",
            context=ApplicationRejectedContext(
                first_name=human.first_name or "",
                last_name=human.last_name or "",
                popup_name=popup.name,
            ),
            from_address=from_address,
            from_name=from_name,
            popup_id=application.popup_id,
            db_session=db,
        )
    # DRAFT, WITHDRAWN: no email
