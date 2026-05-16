import csv
import io
import uuid
from collections import Counter
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
    PopupAccessResponse,
    ScholarshipDecisionRequest,
)
from app.api.application_review.crud import application_reviews_crud
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeePublic,
    AttendeePurchases,
    AttendeeUpdate,
    AttendeeWithTickets,
)
from app.api.shared.enums import SaleType, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    CurrentOperator,
    HumanTenantSession,
    TenantSession,
)
from app.services.email_helpers import send_application_status_email

router = APIRouter(prefix="/applications", tags=["applications"])

# Portal router — separate prefix for the access endpoint
portal_router = APIRouter(prefix="/portal", tags=["portal"])


def _build_application_public(
    application,
    review_decision=None,
) -> ApplicationPublic:
    """Build ApplicationPublic with attendees and products."""
    from app.api.attendee.schemas import AttendeeProductPublic

    attendees = []
    for a in application.attendees:
        # AttendeePublic.products is list[AttendeeProductPublic] — one entry per
        # ticket (per AttendeeProducts row), each carrying its own check_in_code,
        # payment_id, and requires_check_in.
        ticket_products = [
            AttendeeProductPublic(
                id=ap.id,
                attendee_id=ap.attendee_id,
                product_id=ap.product_id,
                check_in_code=ap.check_in_code,
                payment_id=ap.payment_id,
                requires_check_in=ap.product.requires_check_in if ap.product else False,
            )
            for ap in a.attendee_products
        ]
        # Build the base dict from scalar ORM columns only — do NOT call
        # AttendeePublic.model_validate(a) because it triggers ORM property
        # traversal of attendee.products (a @property returning Products rows),
        # which fails Pydantic coercion into AttendeeProductPublic[].
        attendee_data = AttendeePublic(
            id=a.id,
            tenant_id=a.tenant_id,
            application_id=a.application_id,
            popup_id=a.popup_id,
            human_id=a.human_id,
            name=a.name,
            category=a.category,
            email=a.email,
            gender=a.gender,
            check_in_code=a.check_in_code,
            poap_url=a.poap_url,
            created_at=getattr(a, "created_at", None),
            updated_at=getattr(a, "updated_at", None),
            products=ticket_products,
        )
        attendees.append(attendee_data)

    # Build ApplicationPublic explicitly. Calling model_validate(application)
    # would trigger recursive coercion of `attendees` → AttendeePublic, which
    # in turn reads the Attendees.products @property (returning Products rows)
    # and fails Pydantic validation into AttendeeProductPublic[].
    from app.api.human.schemas import HumanPublic

    app_public = ApplicationPublic(
        id=application.id,
        tenant_id=application.tenant_id,
        popup_id=application.popup_id,
        human_id=application.human_id,
        group_id=application.group_id,
        referral=application.referral,
        info_not_shared=application.info_not_shared or [],
        status=application.status,
        custom_fields=application.custom_fields or {},
        custom_fields_schema=application.custom_fields_schema,
        credit=application.credit,
        submitted_at=application.submitted_at,
        accepted_at=application.accepted_at,
        created_at=getattr(application, "created_at", None),
        updated_at=getattr(application, "updated_at", None),
        scholarship_request=application.scholarship_request,
        scholarship_details=application.scholarship_details,
        scholarship_video_url=application.scholarship_video_url,
        scholarship_status=application.scholarship_status,
        discount_percentage=application.discount_percentage,
        incentive_amount=application.incentive_amount,
        incentive_currency=application.incentive_currency,
        human=HumanPublic.model_validate(application.human)
        if application.human
        else None,
        attendees=attendees,
        red_flag=application.red_flag,
        review_decision=review_decision,
    )
    return app_public


@router.get("", response_model=ListModel[ApplicationPublic])
async def list_applications(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID | None = None,
    human_id: uuid.UUID | None = None,
    reviewed_by: uuid.UUID | None = None,
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
            reviewed_by=reviewed_by,
        )
    elif human_id:
        applications, total = crud.applications_crud.find_by_human(
            db, human_id=human_id, skip=skip, limit=limit
        )
    else:
        applications, total = crud.applications_crud.find(db, skip=skip, limit=limit)

    review_decisions = (
        application_reviews_crud.get_decisions_by_reviewer_for_applications(
            db,
            reviewed_by,
            [application.id for application in applications],
        )
        if reviewed_by
        else {}
    )

    results = [
        _build_application_public(
            application,
            review_decision=review_decisions.get(application.id),
        )
        for application in applications
    ]

    return ListModel[ApplicationPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("", response_model=ApplicationPublic, status_code=status.HTTP_201_CREATED)
async def create_application_admin(
    app_in: ApplicationAdminCreate,
    db: TenantSession,
    current_user: CurrentOperator,
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
    _: CurrentOperator,
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
        # Use the direct Attendees→Popups relationship so this works for both
        # application-linked attendees (application_id IS NOT NULL) and direct-sale
        # attendees (application_id IS NULL). The attendee.application path would
        # raise AttributeError for direct-sale attendees.
        popup = attendee.popup

        # Build product list — group ticket rows by product_id and count.
        counts = Counter(ap.product_id for ap in attendee.attendee_products)
        seen = {ap.product_id: ap.product for ap in attendee.attendee_products}
        products = [
            TicketProduct(
                name=seen[pid].name,
                category=seen[pid].category,
                quantity=qty,
            )
            for pid, qty in counts.items()
        ]

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
        from app.api.application.schemas import AttendeeTicketInfo

        return CompanionParticipation(
            attendee=AttendeeInfo(
                id=attendee.id,
                name=attendee.name,
                category=attendee.category,
                check_in_code=attendee.check_in_code,
                tickets=[
                    AttendeeTicketInfo(id=ap.id, check_in_code=ap.check_in_code)
                    for ap in attendee.attendee_products
                ],
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
        # Each AttendeeProducts row is one ticket — group by product_id and count.
        counts = Counter(ap.product_id for ap in attendee.attendee_products)
        seen = {ap.product_id: ap.product for ap in attendee.attendee_products}
        products = []
        for pid, qty in counts.items():
            product = ProductWithQuantity.model_validate(seen[pid])
            product.quantity = qty
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

    # Detect group-flow update (existing applicant clicking an invite link).
    # Validation mirrors create_internal so an arbitrary group_id can't be
    # injected to suppress acceptance emails or bypass whitelisting.
    is_group_join = app_update.get("group_id") is not None
    if is_group_join:
        from app.api.group.crud import groups_crud

        group = groups_crud.get(db, app_update["group_id"])
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Group not found",
            )
        if group.popup_id != popup_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group does not belong to this popup",
            )
        if not group.is_open and not group.has_whitelisted_email(
            current_human.email
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your email is not whitelisted for this group",
            )

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

    if is_group_join:
        # Group invite links bypass the popup's approval strategy and force
        # accept/reject — same behavior as create_internal so a brand-new
        # signup and an existing in-review user both end up able to buy.
        from sqlmodel import select

        from app.api.group.models import GroupMembers

        if current_human.red_flag:
            application.status = ApplicationStatus.REJECTED.value
            crud.applications_crud.create_snapshot(
                db, application, "auto_rejected"
            )
        else:
            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
            crud.applications_crud.create_snapshot(
                db, application, "auto_accepted"
            )
            # Sync GroupMembers junction (vigente membership). Application.group_id
            # was set via setattr above; the junction is the authoritative source
            # for "currently in this group" — see commit 756f55a.
            existing_member = db.exec(
                select(GroupMembers).where(
                    GroupMembers.group_id == app_update["group_id"],
                    GroupMembers.human_id == current_human.id,
                )
            ).first()
            if not existing_member:
                db.add(
                    GroupMembers(
                        tenant_id=current_human.tenant_id,
                        group_id=app_update["group_id"],
                        human_id=current_human.id,
                    )
                )
    elif (
        app_update.get("status") == ApplicationStatus.IN_REVIEW.value
        and application.human
    ):
        # Apply approval strategy when transitioning draft → IN_REVIEW
        # Intercept: if popup requires application fee AND not already paid
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, application.popup_id)
        if popup and popup.requires_application_fee:
            from app.api.payment.crud import payments_crud
            from app.api.payment.schemas import PaymentStatus as PmtStatus

            existing_fee = payments_crud.get_latest_fee_payment(db, application.id)
            fee_already_paid = (
                existing_fee is not None
                and existing_fee.status == PmtStatus.APPROVED.value
            )

            if fee_already_paid:
                crud.applications_crud._apply_approval_strategy(
                    db, application, application.human
                )
            else:
                application.status = ApplicationStatus.PENDING_FEE.value
                crud.applications_crud.create_snapshot(db, application, "pending_fee")
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

    # Find main attendee and their products — search loaded attendees relationship
    main_attendee = next(
        (a for a in application.attendees if a.category == "main"), None
    )
    products: list[DirectoryProduct] = []

    if main_attendee:
        # Each AttendeeProducts row is one ticket — dedupe by product_id so
        # the directory shows each product once even if the attendee bought
        # multiple tickets of it.
        seen_pids: set[uuid.UUID] = set()
        for ap in main_attendee.attendee_products:
            if ap.product_id in seen_pids:
                continue
            seen_pids.add(ap.product_id)
            p = ap.product
            products.append(
                DirectoryProduct(
                    id=p.id,
                    name=p.name,
                    slug=p.slug,
                    category=p.category,
                    duration_type=p.duration_type,
                )
            )

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
        participation=products,
        associated_attendees=associated,
    )


def _ensure_attendee_directory_enabled(
    db: HumanTenantSession, popup_id: uuid.UUID
) -> None:
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, popup_id)
    if (
        not popup
        or popup.sale_type == SaleType.direct.value
        or not popup.show_attendee_directory
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee directory not found",
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
) -> ListModel[AttendeesDirectoryEntry]:
    """List attendees directory for a popup (Portal).

    Returns accepted applications with at least one product.
    Respects info_not_shared masking.
    """
    _ensure_attendee_directory_enabled(db, popup_id)

    applications, total = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=skip,
        limit=limit,
        q=q,
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
) -> Response:
    """Export attendees directory as CSV (Portal).

    No pagination — fetches all matching entries.
    """
    _ensure_attendee_directory_enabled(db, popup_id)

    applications, _ = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=0,
        limit=10000,
        q=q,
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
        category_id=attendee_in.category_id,
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


# ---------------------------------------------------------------------------
# Portal access endpoint (CAP-A)
# ---------------------------------------------------------------------------


@portal_router.get(
    "/popup/{popup_id}/access",
    response_model=PopupAccessResponse,
)
async def get_popup_access(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> PopupAccessResponse:
    """Resolve access for the authenticated Human to a specific popup.

    Runs the 7-step access ladder and returns a structured tristate response:
    - allowed: bool
    - source: which ladder step granted access (application/attendee/payment/companion)
    - application_status: the application's status when an application exists
    - reason: denial reason (no_access/application_pending/application_rejected)

    Requires OTP-authenticated Human token. Always returns 200 (never 404).
    """
    return crud.applications_crud.resolve_popup_access(db, current_human.id, popup_id)
