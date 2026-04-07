import csv
import io
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from app.api.application import crud
from app.api.application.schemas import (
    ApplicantParticipation,
    ApplicationAdminCreate,
    ApplicationCreate,
    ApplicationPublic,
    ApplicationStatus,
    ApplicationUpdate,
    AssociatedAttendee,
    AttendeeInfo,
    AttendeesDirectoryEntry,
    CompanionParticipation,
    DirectoryProduct,
    NoParticipation,
    ParticipationResponse,
    ScholarshipDecisionRequest,
)
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeePublic,
    AttendeePurchases,
    AttendeeUpdate,
    AttendeeWithTickets,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)
from app.services.email_helpers import send_application_status_email

router = APIRouter(prefix="/applications", tags=["applications"])


def _build_application_public(application) -> ApplicationPublic:
    """Build ApplicationPublic with attendees and products."""
    attendees = []
    for a in application.attendees:
        products = []
        for ap in a.attendee_products:
            from app.api.product.schemas import ProductWithQuantity

            product = ProductWithQuantity.model_validate(ap.product)
            product.quantity = ap.quantity
            products.append(product)

        attendee_data = AttendeePublic.model_validate(a)
        attendee_data.products = products
        attendees.append(attendee_data)

    app_public = ApplicationPublic.model_validate(application)
    app_public.attendees = attendees
    app_public.red_flag = application.red_flag
    return app_public


@router.get("", response_model=ListModel[ApplicationPublic])
async def list_applications(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    human_id: uuid.UUID | None = None,
    status_filter: ApplicationStatus | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ApplicationPublic]:
    """List applications with optional filters (BO only)."""
    if popup_id:
        applications, total = crud.applications_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            status_filter=status_filter,
            search=search,
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
    current_user: CurrentWriter,
) -> ApplicationPublic:
    """Create an application as admin (BO only - superadmin for testing).

    This endpoint allows creating applications on behalf of users.
    A Human record will be found or created based on the email.
    """

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

    if application.human:
        await send_application_status_email(application, application.human, db)

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


@router.get("/my/applications", response_model=ListModel[ApplicationPublic])
async def list_my_applications(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
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
    db: HumanTenantSession,
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


@router.get("/my/participation/{popup_id}", response_model=ParticipationResponse)
async def get_my_participation(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> ParticipationResponse:
    """Get participation status for the current human in a popup (Portal).

    Returns a discriminated union:
    - "applicant" if the human has an application for this popup
    - "companion" if the human is an attendee on someone else's application
    - "none" if the human has no participation
    """
    # 1. Check if human is the main applicant
    application = crud.applications_crud.get_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )
    if application:
        return ApplicantParticipation(
            application_id=application.id,
            status=application.status,
        )

    # 2. Check if human is a companion on someone else's application
    from app.api.attendee.crud import attendees_crud

    attendee = attendees_crud.find_companion_for_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )
    if attendee:
        return CompanionParticipation(
            attendee=AttendeeInfo(
                id=attendee.id,
                name=attendee.name,
                category=attendee.category,
                check_in_code=attendee.check_in_code,
            ),
            application_status=attendee.application.status,
        )

    # 3. No participation
    return NoParticipation()


@router.get("/my/{popup_id}/purchases", response_model=list[AttendeePurchases])
async def get_my_purchases(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> list[AttendeePurchases]:
    """Get purchased products grouped by attendee for a popup (Portal)."""
    from app.api.attendee.crud import attendees_crud
    from app.api.product.schemas import ProductWithQuantity

    attendees = attendees_crud.find_purchases_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )

    results = []
    for attendee in attendees:
        products = []
        for ap in attendee.attendee_products:
            product = ProductWithQuantity.model_validate(ap.product)
            product.quantity = ap.quantity
            products.append(product)

        results.append(
            AttendeePurchases(
                attendee_id=attendee.id,
                attendee_name=attendee.name,
                attendee_category=attendee.category,
                products=products,
            )
        )

    return results


@router.get("/my/{popup_id}", response_model=ApplicationPublic)
async def get_my_application(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
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
    db: HumanTenantSession,
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

    # Check if human is already a companion on someone else's application
    from app.api.attendee.crud import attendees_crud

    companion = attendees_crud.find_companion_for_popup(
        db, human_id=current_human.id, popup_id=app_in.popup_id
    )
    if companion:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You are already participating as a companion in this popup",
        )

    # Validate scholarship request against popup settings
    if app_in.scholarship_request is True:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, app_in.popup_id)
        if not popup or not popup.allows_scholarship:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This popup does not accept scholarship requests",
            )

    # Create application
    application = crud.applications_crud.create_internal(
        db,
        app_data=app_in,
        tenant_id=current_human.tenant_id,
        human_id=current_human.id,
    )

    # Send appropriate email based on application status
    await send_application_status_email(application, current_human, db)

    return _build_application_public(application)


@router.patch("/my/{popup_id}", response_model=ApplicationPublic)
async def update_my_application(
    popup_id: uuid.UUID,
    app_in: ApplicationUpdate,
    db: HumanTenantSession,
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

    # Only allow updates for draft, pending_fee, in_review, or accepted
    if application.status not in [
        ApplicationStatus.DRAFT.value,
        ApplicationStatus.PENDING_FEE.value,
        ApplicationStatus.IN_REVIEW.value,
        ApplicationStatus.ACCEPTED.value,
    ]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update application in current status",
        )

    # Separate profile fields from application fields
    from app.api.human.crud import humans_crud
    from app.api.human.schemas import HumanUpdate

    update_data = app_in.model_dump(exclude_unset=True)

    profile_fields = {
        "first_name",
        "last_name",
        "telegram",
        "gender",
        "age",
        "residence",
    }
    profile_update = {k: v for k, v in update_data.items() if k in profile_fields}
    app_update = {k: v for k, v in update_data.items() if k not in profile_fields}

    # Update human profile if needed
    if profile_update:
        humans_crud.update(db, application.human, HumanUpdate(**profile_update))

    # Handle status change to IN_REVIEW
    if "status" in app_update:
        if hasattr(app_update["status"], "value"):
            app_update["status"] = app_update["status"].value

        # When application is pending fee payment, silently block status change to in_review
        if (
            application.status == ApplicationStatus.PENDING_FEE.value
            and app_update["status"] == ApplicationStatus.IN_REVIEW.value
        ):
            app_update["status"] = ApplicationStatus.PENDING_FEE.value

        if app_update["status"] == ApplicationStatus.IN_REVIEW.value:
            if not application.submitted_at:
                app_update["submitted_at"] = datetime.now(UTC)

    for field, value in app_update.items():
        setattr(application, field, value)

    # Capture status before approval strategy may change it
    status_before_str = application.status

    # Apply approval strategy when transitioning draft → IN_REVIEW
    if (
        app_update.get("status") == ApplicationStatus.IN_REVIEW.value
        and application.human
    ):
        # Intercept: if popup requires application fee, gate on PENDING_FEE
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, application.popup_id)
        if popup and popup.requires_application_fee:
            application.status = ApplicationStatus.PENDING_FEE.value
            crud.applications_crud.create_snapshot(
                db, application, "pending_fee"
            )
        else:
            crud.applications_crud._apply_approval_strategy(
                db, application, application.human
            )

    db.add(application)
    db.commit()
    db.refresh(application)

    # Send appropriate email based on final application status
    await send_application_status_email(
        application, current_human, db, status_before=status_before_str
    )

    return _build_application_public(application)


def _build_directory_entry(application) -> AttendeesDirectoryEntry:
    """Build a single directory entry from an application."""
    human = application.human
    info_hidden = set(application.info_not_shared or [])

    def mask(field: str, value: str | None) -> str | None:
        return "*" if field in info_hidden else value

    # Find main attendee and their products
    main_attendee = application.get_main_attendee()
    products: list[DirectoryProduct] = []
    check_in = None
    check_out = None

    if main_attendee:
        for ap in main_attendee.attendee_products:
            p = ap.product
            products.append(
                DirectoryProduct(
                    id=p.id,
                    name=p.name,
                    slug=p.slug,
                    category=p.category,
                    duration_type=p.duration_type,
                    start_date=p.start_date,
                    end_date=p.end_date,
                )
            )
            if p.start_date:
                if check_in is None or p.start_date < check_in:
                    check_in = p.start_date
            if p.end_date:
                if check_out is None or p.end_date > check_out:
                    check_out = p.end_date

    has_kids = any(a.category == "kid" for a in application.attendees)
    brings_kids: bool | str = "*" if "brings_kids" in info_hidden else has_kids

    associated = [
        AssociatedAttendee(
            name=a.name,
            category=a.category,
            gender=a.gender,
            email=a.email,
        )
        for a in application.attendees
        if a.category != "main"
    ]

    # Read organization/role from application custom_fields
    custom = application.custom_fields or {}

    return AttendeesDirectoryEntry(
        id=application.id,
        first_name=mask("first_name", human.first_name if human else None),
        last_name=mask("last_name", human.last_name if human else None),
        email=mask("email", human.email if human else None),
        telegram=mask("telegram", human.telegram if human else None),
        role=mask("role", custom.get("role")),
        organization=mask("organization", custom.get("organization")),
        residence=mask("residence", human.residence if human else None),
        age=mask("age", human.age if human else None),
        gender=mask("gender", human.gender if human else None),
        picture_url=human.picture_url if human else None,
        brings_kids=brings_kids,
        participation=products,
        check_in=check_in,
        check_out=check_out,
        associated_attendees=associated,
    )


@router.get(
    "/my/directory/{popup_id}", response_model=ListModel[AttendeesDirectoryEntry]
)
async def list_attendees_directory(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
    q: str | None = None,
    brings_kids: bool | None = None,
    participation: str | None = None,
) -> ListModel[AttendeesDirectoryEntry]:
    """List attendees directory for a popup (Portal).

    Returns accepted applications with at least one product.
    Respects info_not_shared masking.
    """
    applications, total = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=skip,
        limit=limit,
        q=q,
        brings_kids=brings_kids,
        participation=participation,
    )

    results = [_build_directory_entry(a) for a in applications]

    return ListModel[AttendeesDirectoryEntry](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/my/directory/{popup_id}/csv")
async def export_attendees_directory_csv(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    q: str | None = None,
    brings_kids: bool | None = None,
    participation: str | None = None,
) -> Response:
    """Export attendees directory as CSV (Portal).

    No pagination — fetches all matching entries.
    """
    applications, _ = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=0,
        limit=10000,
        q=q,
        brings_kids=brings_kids,
        participation=participation,
    )

    entries = [_build_directory_entry(a) for a in applications]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "First Name",
            "Last Name",
            "Email",
            "Telegram",
            "Role",
            "Organization",
            "Residence",
            "Age",
            "Gender",
            "Brings Kids",
            "Check In",
            "Check Out",
        ]
    )
    for e in entries:
        writer.writerow(
            [
                e.first_name or "",
                e.last_name or "",
                e.email or "",
                e.telegram or "",
                e.role or "",
                e.organization or "",
                e.residence or "",
                e.age or "",
                e.gender or "",
                str(e.brings_kids),
                e.check_in.isoformat() if e.check_in else "",
                e.check_out.isoformat() if e.check_out else "",
            ]
        )

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendees.csv"},
    )


@router.post(
    "/my/{popup_id}/attendees",
    response_model=ApplicationPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_my_attendee(
    popup_id: uuid.UUID,
    attendee_in: AttendeeCreate,
    db: HumanTenantSession,
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
    db: HumanTenantSession,
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
    db: HumanTenantSession,
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


@router.patch(
    "/{application_id}/scholarship",
    response_model=ApplicationPublic,
)
async def review_scholarship(
    application_id: uuid.UUID,
    decision: ScholarshipDecisionRequest,
    db: TenantSession,
    _: CurrentAdmin,
) -> ApplicationPublic:
    """Approve or reject a scholarship request on an application (BO admin only).

    Updates scholarship fields and re-runs the approval calculator.
    If the application transitions to ACCEPTED as a result, sends the
    appropriate scholarship acceptance email to the applicant.
    """
    # Capture status before the CRUD call so we can detect transitions
    application = crud.applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )
    status_before = application.status

    # Perform scholarship decision + recalculate approval status
    application = crud.applications_crud.review_scholarship(
        db,
        application_id=application_id,
        decision=decision,
    )

    # Send email only if status changed (e.g., IN_REVIEW → ACCEPTED)
    if application.human:
        await send_application_status_email(
            application,
            application.human,
            db,
            status_before=status_before,
        )

    return _build_application_public(application)
