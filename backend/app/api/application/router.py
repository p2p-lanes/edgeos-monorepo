import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, status

from app.api.application import crud
from app.api.application.schemas import (
    ApplicationAdminCreate,
    ApplicationAdminUpdate,
    ApplicationCreate,
    ApplicationPublic,
    ApplicationStatus,
    ApplicationUpdate,
)
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeePublic,
    AttendeeUpdate,
    AttendeeWithTickets,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    SessionDep,
    TenantSession,
)
from app.services.email import ApplicationReceivedContext, get_email_service

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic

router = APIRouter(prefix="/applications", tags=["applications"])


def _check_write_permission(current_user: "UserPublic") -> None:
    """Check if user has write permission."""
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role does not have write access",
        )


def _build_application_public(application) -> ApplicationPublic:
    """Build ApplicationPublic with attendees and products."""
    attendees = []
    for a in application.attendees:
        products = []
        for ap in a.attendee_products:
            from app.api.product.schemas import ProductWithQuantity

            product_data = ap.product.__dict__.copy()
            product_data["quantity"] = ap.quantity
            products.append(ProductWithQuantity(**product_data))

        attendee_data = AttendeePublic.model_validate(a)
        attendee_data.products = products
        attendees.append(attendee_data)

    app_public = ApplicationPublic.model_validate(application)
    app_public.attendees = attendees
    app_public.red_flag = application.red_flag
    return app_public


# ========================
# BO (Backoffice) Routes
# ========================


@router.get("", response_model=ListModel[ApplicationPublic])
async def list_applications(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    human_id: uuid.UUID | None = None,
    status_filter: ApplicationStatus | None = None,
    skip: int = 0,
    limit: int = 100,
) -> ListModel[ApplicationPublic]:
    """List applications with optional filters (BO only)."""
    if popup_id:
        applications, total = crud.applications_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            status_filter=status_filter,
        )
    elif human_id:
        applications, total = crud.applications_crud.find_by_human(
            db, human_id=human_id, skip=skip, limit=limit
        )
    else:
        applications, total = crud.applications_crud.find(db, skip=skip, limit=limit)

    results = [_build_application_public(a) for a in applications]

    return ListModel[ApplicationPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("", response_model=ApplicationPublic, status_code=status.HTTP_201_CREATED)
async def create_application_admin(
    app_in: ApplicationAdminCreate,
    db: TenantSession,
    current_user: CurrentUser,
) -> ApplicationPublic:
    """Create an application as admin (BO only - superadmin for testing).

    This endpoint allows creating applications on behalf of users.
    A Human record will be found or created based on the email.
    """
    _check_write_permission(current_user)

    # For now, only superadmins can create applications via backoffice
    if current_user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmins can create applications via backoffice",
        )

    # Get tenant_id from current user or popup
    if current_user.tenant_id:
        tenant_id = current_user.tenant_id
    else:
        # Superadmin - get tenant from popup
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, app_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id

    application = crud.applications_crud.create_admin(
        db,
        app_data=app_in,
        tenant_id=tenant_id,
    )

    return _build_application_public(application)


@router.get("/{application_id}", response_model=ApplicationPublic)
async def get_application(
    application_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> ApplicationPublic:
    """Get a single application (BO only)."""
    application = crud.applications_crud.get(db, application_id)

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    return _build_application_public(application)


@router.patch("/{application_id}", response_model=ApplicationPublic)
async def update_application_admin(
    application_id: uuid.UUID,
    app_in: ApplicationAdminUpdate,
    db: TenantSession,
    current_user: CurrentUser,
) -> ApplicationPublic:
    """Update an application (BO - admin access with extended fields)."""
    _check_write_permission(current_user)

    application = crud.applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Prevent approving/rejecting draft applications - they must be submitted first
    if application.status == ApplicationStatus.DRAFT.value and app_in.status in [
        ApplicationStatus.ACCEPTED,
        ApplicationStatus.REJECTED,
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot approve or reject a draft application. The applicant must submit it first.",
        )

    # Prevent accepting red-flagged humans
    if app_in.status == ApplicationStatus.ACCEPTED:
        human_red_flag = application.human.red_flag if application.human else False
        if human_red_flag:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot accept application from a red-flagged human.",
            )

    # Handle status change to ACCEPTED
    if (
        app_in.status == ApplicationStatus.ACCEPTED
        and application.status != ApplicationStatus.ACCEPTED.value
    ):
        app_in_dict = app_in.model_dump(exclude_unset=True)
        app_in_dict["accepted_at"] = datetime.now(UTC)
        app_in_dict["status"] = app_in.status.value

        for field, value in app_in_dict.items():
            setattr(application, field, value)
    else:
        update_data = app_in.model_dump(exclude_unset=True)
        if "status" in update_data and hasattr(update_data["status"], "value"):
            update_data["status"] = update_data["status"].value

        for field, value in update_data.items():
            setattr(application, field, value)

    db.add(application)
    db.commit()
    db.refresh(application)

    return _build_application_public(application)


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_application(
    application_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentUser,
) -> None:
    """Delete an application (BO only)."""
    _check_write_permission(current_user)

    application = crud.applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    crud.applications_crud.delete(db, application)


# ========================
# Portal (Human) Routes
# ========================


@router.get("/my/applications", response_model=ListModel[ApplicationPublic])
async def list_my_applications(
    db: SessionDep,
    current_human: CurrentHuman,
    skip: int = 0,
    limit: int = 100,
) -> ListModel[ApplicationPublic]:
    """List applications for the current human (Portal)."""
    applications, total = crud.applications_crud.find_by_human(
        db, human_id=current_human.id, skip=skip, limit=limit
    )

    results = [_build_application_public(a) for a in applications]

    return ListModel[ApplicationPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/my/tickets", response_model=list[AttendeeWithTickets])
async def list_my_tickets(
    db: SessionDep,
    current_human: CurrentHuman,
) -> list[AttendeeWithTickets]:
    """List all tickets for the current human (Portal).

    Returns all attendee records linked to this human, including:
    - Attendees from applications they submitted (main attendee)
    - Attendees created by others with their email (e.g., spouse tickets)

    Each attendee includes their check-in code and purchased products.
    """
    from app.api.attendee.crud import attendees_crud
    from app.api.attendee.schemas import TicketProduct

    attendees, _ = attendees_crud.find_by_human(
        db, human_id=current_human.id, limit=1000
    )

    results = []
    for attendee in attendees:
        # Get popup info through application
        popup = attendee.application.popup

        # Build product list
        products = []
        for ap in attendee.attendee_products:
            products.append(
                TicketProduct(
                    name=ap.product.name,
                    category=ap.product.category,
                    start_date=ap.product.start_date,
                    end_date=ap.product.end_date,
                    quantity=ap.quantity,
                )
            )

        results.append(
            AttendeeWithTickets(
                id=attendee.id,
                name=attendee.name,
                email=attendee.email,
                category=attendee.category,
                check_in_code=attendee.check_in_code,
                popup_id=popup.id,
                popup_name=popup.name,
                popup_slug=popup.slug,
                products=products,
            )
        )

    return results


@router.get("/my/{popup_id}", response_model=ApplicationPublic)
async def get_my_application(
    popup_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Get current human's application for a popup (Portal)."""
    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    return _build_application_public(application)


@router.post(
    "/my", response_model=ApplicationPublic, status_code=status.HTTP_201_CREATED
)
async def create_my_application(
    app_in: ApplicationCreate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Create an application for the current human (Portal)."""
    # Check for existing application
    existing = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=app_in.popup_id
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You already have an application for this popup",
        )

    # Create application
    application = crud.applications_crud.create_internal(
        db,
        app_data=app_in,
        tenant_id=current_human.tenant_id,
        human_id=current_human.id,
    )

    # Send application received email if status is IN_REVIEW
    if application.status == ApplicationStatus.IN_REVIEW:
        email_service = get_email_service()
        await email_service.send_application_received(
            to=current_human.email,
            subject=f"Application Received for {application.popup.name}",
            context=ApplicationReceivedContext(
                first_name=current_human.first_name or "",
                last_name=current_human.last_name or "",
                email=current_human.email,
                popup_name=application.popup.name,
            ),
            from_address=application.popup.tenant.sender_email,
            from_name=application.popup.tenant.sender_name,
        )

    return _build_application_public(application)


@router.patch("/my/{popup_id}", response_model=ApplicationPublic)
async def update_my_application(
    popup_id: uuid.UUID,
    app_in: ApplicationUpdate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Update current human's application (Portal)."""
    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Only allow updates for draft or in_review
    if application.status not in [
        ApplicationStatus.DRAFT.value,
        ApplicationStatus.IN_REVIEW.value,
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update application in current status",
        )

    # Handle status change to IN_REVIEW
    update_data = app_in.model_dump(exclude_unset=True)
    if "status" in update_data:
        if hasattr(update_data["status"], "value"):
            update_data["status"] = update_data["status"].value

        if update_data["status"] == ApplicationStatus.IN_REVIEW.value:
            if not application.submitted_at:
                update_data["submitted_at"] = datetime.now(UTC)

    for field, value in update_data.items():
        setattr(application, field, value)

    db.add(application)
    db.commit()
    db.refresh(application)

    # Send application received email if newly submitted
    if (
        application.status == ApplicationStatus.IN_REVIEW.value
        and "status" in update_data
    ):
        # TODO: Send email
        pass

    return _build_application_public(application)


# ========================
# Attendee Management (Portal)
# ========================


@router.post(
    "/my/{popup_id}/attendees",
    response_model=ApplicationPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_my_attendee(
    popup_id: uuid.UUID,
    attendee_in: AttendeeCreate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Add an attendee to current human's application (Portal)."""
    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    crud.applications_crud.create_attendee(
        db,
        application=application,
        name=attendee_in.name,
        category=attendee_in.category,
        email=attendee_in.email,
        gender=attendee_in.gender,
    )

    return _build_application_public(application)


@router.patch(
    "/my/{popup_id}/attendees/{attendee_id}",
    response_model=ApplicationPublic,
)
async def update_my_attendee(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Update an attendee in current human's application (Portal)."""
    from app.api.attendee.crud import attendees_crud

    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    # Find attendee
    attendee = next((a for a in application.attendees if a.id == attendee_id), None)
    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    # Check for duplicate email
    if attendee_in.email:
        existing_emails = [
            a.email for a in application.attendees if a.email and a.id != attendee_id
        ]
        if attendee_in.email.lower() in existing_emails:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attendee with this email already exists",
            )

    attendees_crud.update_attendee(db, attendee, attendee_in)
    db.refresh(application)

    return _build_application_public(application)


@router.delete(
    "/my/{popup_id}/attendees/{attendee_id}",
    response_model=ApplicationPublic,
)
async def delete_my_attendee(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    db: SessionDep,
    current_human: CurrentHuman,
) -> ApplicationPublic:
    """Delete an attendee from current human's application (Portal)."""
    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    crud.applications_crud.delete_attendee(db, application, attendee_id)

    return _build_application_public(application)
