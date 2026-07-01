import csv
import io
import uuid
from collections import Counter
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from loguru import logger

from app.api.application import crud
from app.api.application.schemas import (
    AdminGrantTicketsRequest,
    AdminGrantTicketsResponse,
    ApplicantParticipation,
    ApplicationAdminCreate,
    ApplicationCreate,
    ApplicationPublic,
    ApplicationStatus,
    ApplicationUpdate,
    AttendeeInfo,
    AttendeesDirectoryEntry,
    CompanionParticipation,
    DetachCompanionRequest,
    DirectoryProduct,
    GrantCreditRequest,
    GrantCreditResponse,
    GrantedPaymentInfo,
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
    AdminOrApiKey_ApplicationsRead,
    AdminOrApiKey_ApplicationsWrite,
    AdminOrApiKeySession_ApplicationsRead,
    AdminOrApiKeySession_ApplicationsWrite,
    CurrentAdmin,
    CurrentHuman,
    HumanTenantSession,
    needs,
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
                purchase_metadata=ap.purchase_metadata,
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
    db: AdminOrApiKeySession_ApplicationsRead,
    _: AdminOrApiKey_ApplicationsRead,
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
    db: AdminOrApiKeySession_ApplicationsWrite,
    current_user: AdminOrApiKey_ApplicationsWrite,
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


@router.post(
    "/admin/grant-tickets",
    response_model=AdminGrantTicketsResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Admin bulk-grant of free tickets",
)
async def grant_tickets_admin(
    payload: AdminGrantTicketsRequest,
    db: AdminOrApiKeySession_ApplicationsWrite,
    current_user: AdminOrApiKey_ApplicationsWrite,
) -> AdminGrantTicketsResponse:
    """Atomically grant free tickets to a batch of people for a popup.

    For each person:
      - Get-or-create the Human (fill-blanks on first_name/last_name; never
        overwrites existing values).
      - Get-or-create the Application; if it exists in a non-accepted state,
        promote it to ACCEPTED.
      - Create a $0 Payment (APPROVED, source=NULL, granted_by_user_id=admin)
        with product snapshots, then materialize tickets via the shared
        zero-amount finalizer.

    The whole batch lives in one transaction — a sold-out failure mid-batch
    rolls back every Human / Application / Attendee / Payment row created in
    this run. Stock is decremented up-front for all (person × product) lines
    via the atomic `products_crud.decrement_total_stock` UPDATE; a race-loss
    surfaces as HTTP 409 with a structured `stock_exhausted` payload.

    Confirmation emails are dispatched best-effort post-commit (one per
    person); a mail failure is logged but does NOT undo the grant.
    """
    from sqlmodel import select

    from app.api.attendee.crud import attendees_crud
    from app.api.audit_log.actor import actor_from_user
    from app.api.audit_log.constants import AuditAction, AuditEntityType
    from app.api.audit_log.crud import audit_logs_crud
    from app.api.human.crud import humans_crud
    from app.api.payment.crud import payments_crud
    from app.api.payment.models import PaymentProducts, Payments
    from app.api.payment.router import _send_payment_confirmed_email
    from app.api.payment.schemas import (
        PaymentProductRequest,
        PaymentStatus,
    )
    from app.api.popup.crud import popups_crud
    from app.api.product.crud import products_crud
    from app.api.product.models import Products

    popup = popups_crud.get(db, payload.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    tenant_id = popup.tenant_id

    # Dedupe people by email — the BO does this too but the backend is the
    # last line of defence against accidental double-grants from CSV paste.
    seen_emails: set[str] = set()
    people = []
    for person in payload.people:
        if person.email in seen_emails:
            continue
        seen_emails.add(person.email)
        people.append(person)

    # Union of product IDs referenced by any person — each person now carries
    # their own product list (may be different per person).
    product_ids = {item.product_id for person in people for item in person.products}
    products_stmt = select(Products).where(
        Products.id.in_(product_ids),  # type: ignore[attr-defined]
        Products.popup_id == payload.popup_id,
        Products.is_active == True,  # noqa: E712
        Products.deleted_at.is_(None),  # type: ignore[attr-defined]
    )
    valid_products = list(db.exec(products_stmt).all())
    if {p.id for p in valid_products} != product_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="One or more products are unavailable, inactive, or not in this popup",
        )
    products_map = {p.id: p for p in valid_products}

    # Aggregate total requested quantity per product across ALL people for the
    # up-front stock cap check. Each person may request a different mix, so
    # this sum is what we compare against total_stock_remaining.
    total_needed_per_product: dict[uuid.UUID, int] = {}
    for person in people:
        for item in person.products:
            total_needed_per_product[item.product_id] = (
                total_needed_per_product.get(item.product_id, 0) + item.quantity
            )

    # Up-front stock cap check — cheap, returns 409 immediately on a gross
    # over-grant before we start writing anything. The per-decrement guard
    # below still catches losing the race with a concurrent buyer.
    for pid, total_needed in total_needed_per_product.items():
        product = products_map[pid]
        if (
            product.total_stock_remaining is not None
            and product.total_stock_remaining < total_needed
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "stock_exhausted",
                    "product_id": str(pid),
                    "product_name": product.name,
                    "requested": total_needed,
                    "available": product.total_stock_remaining,
                    "message": (
                        f"Not enough stock for '{product.name}' — "
                        f"need {total_needed}, have {product.total_stock_remaining}"
                    ),
                },
            )

    granted: list[GrantedPaymentInfo] = []
    payment_ids: list[uuid.UUID] = []
    try:
        for person in people:
            human = humans_crud.get_or_create_by_email(
                db,
                email=person.email,
                tenant_id=tenant_id,
                default_first_name=person.first_name,
                default_last_name=person.last_name,
            )
            # Fill-blanks on an existing Human — never clobber a name the
            # user has already provided themselves.
            mutated = False
            if person.first_name and not human.first_name:
                human.first_name = person.first_name
                mutated = True
            if person.last_name and not human.last_name:
                human.last_name = person.last_name
                mutated = True
            if mutated:
                db.add(human)
                db.flush()

            application = crud.applications_crud.get_by_human_popup(
                db, human_id=human.id, popup_id=payload.popup_id
            )
            if application is None:
                application = crud.applications_crud.create_for_admin_grant(
                    db,
                    tenant_id=tenant_id,
                    popup_id=payload.popup_id,
                    human=human,
                )
            else:
                crud.applications_crud.promote_to_accepted(db, application)

            main_attendee = attendees_crud.get_main_attendee(db, application.id)
            if main_attendee is None:
                # Should be impossible — create_for_admin_grant always inserts
                # one, and an existing application always has a main attendee.
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Main attendee not found for application",
                )

            # Per-product, per-quantity stock decrement. Raises 409 if a
            # concurrent buyer drained the counter between our pre-check and
            # now; the outer try/except rolls the entire batch back.
            ticket_count = 0
            for item in person.products:
                products_crud.decrement_total_stock(db, item.product_id, item.quantity)
                ticket_count += item.quantity

            payment = Payments(
                tenant_id=tenant_id,
                application_id=application.id,
                popup_id=payload.popup_id,
                status=PaymentStatus.PENDING.value,
                amount=Decimal("0"),
                currency=popup.currency,
                source=None,
            )
            db.add(payment)
            db.flush()

            finalize_lines: list[PaymentProductRequest] = []
            for item in person.products:
                product = products_map[item.product_id]
                is_patreon = product.category == "patreon"
                # Patron snapshot: product_price=0, effective_unit_price=0,
                # qty honored as the admin requested it — donation amount is
                # explicitly skipped for comps (locked decision §3.5 / §8.3).
                snapshot = PaymentProducts(
                    tenant_id=tenant_id,
                    payment_id=payment.id,
                    product_id=item.product_id,
                    attendee_id=main_attendee.id,
                    quantity=item.quantity,
                    product_name=product.name,
                    product_description=product.description,
                    product_price=Decimal("0") if is_patreon else product.price,
                    product_category=product.category or "",
                    product_currency=popup.currency,
                    effective_unit_price=Decimal("0") if is_patreon else None,
                )
                db.add(snapshot)
                finalize_lines.append(
                    PaymentProductRequest(
                        product_id=item.product_id,
                        attendee_id=main_attendee.id,
                        quantity=item.quantity,
                    )
                )

            payments_crud._finalize_zero_amount_payment(
                db,
                payment,
                finalize_lines,
                granted_by_user_id=current_user.id,
            )

            # Audit the grant under the attendee, inside the batch transaction.
            audit_logs_crud.record(
                db,
                tenant_id=tenant_id,
                actor=actor_from_user(current_user),
                action=AuditAction.TICKET_GRANT,
                entity_type=AuditEntityType.ATTENDEE,
                entity_id=main_attendee.id,
                entity_label=main_attendee.name,
                popup_id=payload.popup_id,
                details={
                    "payment_id": str(payment.id),
                    "tickets_created": ticket_count,
                    "products": [
                        {
                            "product_id": str(item.product_id),
                            "product_name": products_map[item.product_id].name,
                            "quantity": item.quantity,
                        }
                        for item in person.products
                    ],
                },
            )

            granted.append(
                GrantedPaymentInfo(
                    payment_id=payment.id,
                    application_id=application.id,
                    human_id=human.id,
                    email=human.email,
                    tickets_created=ticket_count,
                )
            )
            payment_ids.append(payment.id)

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        logger.exception("Admin grant-tickets batch failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to grant tickets",
        )

    # Best-effort post-commit confirmation emails. A mail failure here does
    # NOT undo the grant — the rows are already persisted and the admin can
    # resend manually if a recipient reports a missing email.
    for payment_id in payment_ids:
        try:
            payment = payments_crud.get(db, payment_id)
            if payment is not None:
                await _send_payment_confirmed_email(payment, db_session=db)
        except Exception:
            logger.exception(
                "Failed to send PAYMENT_CONFIRMED for granted payment {}",
                payment_id,
            )

    return AdminGrantTicketsResponse(granted=granted)


@router.get("/{application_id}", response_model=ApplicationPublic)
async def get_application(
    application_id: uuid.UUID,
    db: AdminOrApiKeySession_ApplicationsRead,
    _: AdminOrApiKey_ApplicationsRead,
) -> ApplicationPublic:
    """Get a single application (BO only)."""
    application = crud.applications_crud.get(db, application_id)

    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    return _build_application_public(application)


@router.post(
    "/{application_id}/credit",
    response_model=GrantCreditResponse,
    summary="Grant credit to an application",
)
async def grant_application_credit(
    application_id: uuid.UUID,
    payload: GrantCreditRequest,
    db: AdminOrApiKeySession_ApplicationsWrite,
    current_user: CurrentAdmin,
) -> GrantCreditResponse:
    """Grant credit to a specific application (BO admin only).

    Calls the central adjust_application_credit helper — the only writer of
    application.credit — with source=manual and the authenticated admin as actor.
    Returns the updated credit balance.
    """
    from app.api.audit_log.actor import actor_from_user
    from app.api.audit_log.constants import AuditAction
    from app.api.payment.crud import adjust_application_credit

    application = crud.applications_crud.get(db, application_id)
    if not application:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    new_balance = adjust_application_credit(
        db,
        application,
        payload.amount,
        kind=AuditAction.CREDIT_GRANTED,
        source="manual",
        actor=actor_from_user(current_user),
        note=payload.note,
    )
    db.commit()

    return GrantCreditResponse(application_id=application_id, credit=new_balance)


@router.get(
    "/my/applications",
    response_model=ListModel[ApplicationPublic],
    summary="List your applications",
    dependencies=[needs("portal:applications:read")],
)
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


@router.get(
    "/my/tickets",
    response_model=list[AttendeeWithTickets],
    summary="List your tickets",
    dependencies=[needs("portal:applications:read")],
)
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
                popup_id=popup.id,
                popup_name=popup.name,
                popup_slug=popup.slug,
                products=products,
            )
        )

    return results


@router.get(
    "/my/participation/{popup_id}",
    response_model=ParticipationResponse,
    summary="Get your participation in a popup",
    dependencies=[needs("portal:applications:read")],
)
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
    from app.api.check_in.crud import get_last_scan_by_tickets

    attendee = attendees_crud.find_companion_for_popup(
        db, human_id=current_human.id, popup_id=popup_id
    )
    if attendee:
        from app.api.application.schemas import AttendeeTicketInfo

        host_human = attendee.application.human if attendee.application else None
        # Single aggregation across all of this companion's tickets so the
        # portal can flag already-scanned QR codes without N+1 lookups —
        # matches the pattern used for the main applicant pass view.
        ticket_ids = [ap.id for ap in attendee.attendee_products]
        last_scan_by_ticket = get_last_scan_by_tickets(db, ticket_ids)
        return CompanionParticipation(
            attendee=AttendeeInfo(
                id=attendee.id,
                name=attendee.name,
                category=attendee.category,
                tickets=[
                    AttendeeTicketInfo(
                        id=ap.id,
                        check_in_code=ap.check_in_code,
                        product_name=ap.product.name if ap.product else None,
                        product_category=ap.product.category if ap.product else None,
                        requires_check_in=(
                            ap.product.requires_check_in if ap.product else False
                        ),
                        last_scan_at=last_scan_by_ticket.get(ap.id),
                    )
                    for ap in attendee.attendee_products
                ],
            ),
            application_status=attendee.application.status,
            owner_email=host_human.email if host_human else None,
        )

    # 3. No participation
    return NoParticipation()


@router.get(
    "/my/{popup_id}/purchases",
    response_model=list[AttendeePurchases],
    summary="List your purchases for a popup",
    dependencies=[needs("portal:applications:read")],
)
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


@router.get(
    "/my/{popup_id}",
    response_model=ApplicationPublic,
    summary="Get your application for a popup",
    dependencies=[needs("portal:applications:read")],
)
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
    "/my/detach-companion",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Detach yourself as a companion from another application",
    responses={
        409: {
            "description": (
                "Tickets have already been purchased for this attendee on the "
                "host application. Detach blocked; route to support."
            ),
        },
    },
    dependencies=[needs("portal:applications:write")],
)
async def detach_companion(
    body: DetachCompanionRequest,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> None:
    """Remove the current human from being a companion on another applicant's
    application for the given popup.

    Used by the portal when a human arrives at a group invite link but is
    already an attendee on someone else's application — they choose to switch
    to their own application via the group invite.

    Idempotent: returns 204 when the human is not actually a companion.
    Returns 409 when tickets have already been purchased for this attendee
    (money decisions handled by support, not by a checkout button).
    """
    from app.api.attendee.crud import attendees_crud

    companion = attendees_crud.find_companion_for_popup(
        db, human_id=current_human.id, popup_id=body.popup_id
    )
    if not companion:
        return  # idempotent no-op

    if companion.attendee_products:
        host_human = companion.application.human if companion.application else None
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "tickets_already_purchased",
                "owner_email": host_human.email if host_human else None,
                "message": (
                    "Tickets have already been purchased for you on this "
                    "application. Contact support to resolve."
                ),
            },
        )

    host_application = companion.application
    db.delete(companion)
    if host_application:
        crud.applications_crud.create_snapshot(
            db, host_application, "companion_detached"
        )
    db.commit()


@router.post(
    "/my",
    response_model=ApplicationPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Create your application",
    dependencies=[needs("portal:applications:write")],
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


@router.patch(
    "/my/{popup_id}",
    response_model=ApplicationPublic,
    summary="Update your application for a popup",
    dependencies=[needs("portal:applications:write")],
)
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
        if not group.is_open and not group.has_whitelisted_email(current_human.email):
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
            crud.applications_crud.create_snapshot(db, application, "auto_rejected")
        else:
            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
            crud.applications_crud.create_snapshot(db, application, "auto_accepted")
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
            from app.api.application.crud import _maybe_grant_fee_credit

            _maybe_grant_fee_credit(db, application)
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


def _build_directory_entry(attendee) -> AttendeesDirectoryEntry:
    """Build a single directory entry from a ticket-holding attendee.

    The entry is sourced from the attendee's OWN human record, so companions
    (spouse/kid/...) appear as their own people. Field masking and the
    role/organization form fields only apply to the main applicant, since
    companions never filled an application form and have no privacy prefs.
    """
    human = attendee.human
    application = attendee.application
    is_main = attendee.category == "main"

    # info_not_shared masking belongs to the main applicant's own application.
    info_hidden = (
        set(application.info_not_shared or []) if (is_main and application) else set()
    )

    def mask(field: str, value: str | None) -> str | None:
        return "*" if field in info_hidden else value

    # Each AttendeeProducts row is one ticket — dedupe by product_id so the
    # directory shows each product once even if the attendee holds several
    # tickets of it.
    products: list[DirectoryProduct] = []
    seen_pids: set[uuid.UUID] = set()
    for ap in attendee.attendee_products:
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

    # role/organization come from the application form — only meaningful for the
    # main applicant. Companions get blank values.
    custom = (application.custom_fields or {}) if (is_main and application) else {}

    return AttendeesDirectoryEntry(
        id=attendee.id,
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
        category=attendee.category,
        associated_attendees=[],
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
    "/my/directory/{popup_id}",
    response_model=ListModel[AttendeesDirectoryEntry],
    summary="List the attendees directory for a popup",
    dependencies=[needs("portal:directory:read")],
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

    attendees, total = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=skip,
        limit=limit,
        q=q,
    )

    results = [_build_directory_entry(a) for a in attendees]

    return ListModel[AttendeesDirectoryEntry](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get(
    "/my/directory/{popup_id}/csv",
    summary="Export the attendees directory for a popup as CSV",
    dependencies=[needs("portal:directory:read")],
)
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

    attendees, _ = crud.applications_crud.find_directory(
        db,
        popup_id=popup_id,
        skip=0,
        limit=10000,
        q=q,
    )

    entries = [_build_directory_entry(a) for a in attendees]

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
    summary="Add an attendee to your application",
    dependencies=[needs("portal:attendees:write")],
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
    summary="Update an attendee on your application",
    dependencies=[needs("portal:attendees:write")],
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
    summary="Remove an attendee from your application",
    dependencies=[needs("portal:attendees:write")],
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
    db: AdminOrApiKeySession_ApplicationsWrite,
    _: AdminOrApiKey_ApplicationsWrite,
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
    summary="Resolve your access for a popup",
    dependencies=[needs("portal:applications:write")],
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
