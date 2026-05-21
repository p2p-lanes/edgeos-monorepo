import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.access.introspection import scope_route
from app.api.attendee import crud
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeeListItem,
    AttendeeProductPublic,
    AttendeeUpdate,
    AttendeeWithOriginPublic,
    AttendeeWithTickets,
    TicketAttendeeSnapshot,
    TicketProduct,
    TicketProductSnapshot,
    TicketPublic,
)
from app.api.check_in.crud import (
    get_check_in_summary,
    get_last_scan_by_tickets,
    record_check_in,
)
from app.api.check_in.schemas import CheckInPayload
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_AttendeesWrite,
    AdminOrApiKeySession_AttendeesWrite,
    CheckInOrApiKey_AttendeesRead,
    CheckInOrApiKeySession_AttendeesRead,
    CurrentCheckInOperator,
    CurrentHuman,
    HumanTenantSession,
    RequireHumanScopeDirectoryRead,
    RequireHumanScopeSelfRead,
    TenantSession,
)

router = APIRouter(prefix="/attendees", tags=["attendees"])

# Pagination type for portal attendees endpoint (max 100 per page)
_AttendeeLimit = Annotated[
    int, Query(ge=1, le=100, description="Max attendees to return")
]


def _build_attendee_with_origin(
    attendee,
    last_scan_by_ticket: dict | None = None,
) -> AttendeeWithOriginPublic:
    """Build an AttendeeWithOriginPublic from an Attendees ORM row.

    Constructs the response manually to avoid the Pydantic from_attributes
    traversal of attendee.products (a SQLAlchemy property returning Products
    ORM objects) colliding with the AttendeeProductPublic schema expected by
    the typed products field. We extract scalar fields directly from the ORM
    object to sidestep ORM property access.

    product_name and product_category prefer the at-purchase snapshot stored in
    payment_products (matched on (payment_id, product_id)) so renames or
    recategorizations after the purchase do not retroactively rewrite a buyer's
    pass. Falls back to live ap.product when the attendee has no payment_id
    (free / application grant) or no snapshot row exists (e.g., cancelled
    payment whose snapshot rows were deleted). start_date, end_date, and
    duration_type are not snapshotted and always read from the live product.

    last_scan_by_ticket is an optional {attendee_product_id: last_scan_at} map
    precomputed by the caller (typically via get_last_scan_by_tickets) so the
    portal can flag already-scanned QR codes without an N+1 lookup. Missing
    keys mean the ticket has never been scanned.
    """
    snapshot_by_pair = {
        (pp.payment_id, pp.product_id): pp for pp in attendee.payment_products
    }

    ticket_products = []
    for ap in attendee.attendee_products:
        snapshot = (
            snapshot_by_pair.get((ap.payment_id, ap.product_id))
            if ap.payment_id is not None
            else None
        )
        if snapshot is not None:
            product_name = snapshot.product_name
            product_category = snapshot.product_category
        else:
            product_name = ap.product.name if ap.product else None
            product_category = ap.product.category if ap.product else None

        ticket_products.append(
            AttendeeProductPublic(
                id=ap.id,
                attendee_id=ap.attendee_id,
                product_id=ap.product_id,
                check_in_code=ap.check_in_code,
                payment_id=ap.payment_id,
                requires_check_in=(
                    ap.product.requires_check_in if ap.product else False
                ),
                product_name=product_name,
                product_category=product_category,
                duration_type=(ap.product.duration_type if ap.product else None),
                last_scan_at=(
                    last_scan_by_ticket.get(ap.id) if last_scan_by_ticket else None
                ),
            )
        )
    origin = "application" if attendee.application_id is not None else "direct_sale"
    # Build the base dict from scalar ORM columns only — do NOT call
    # model_validate(attendee) because it triggers ORM property traversal of
    # attendee.products (a @property returning Products rows), which now fails
    # Pydantic coercion into AttendeeProductPublic[].
    base: dict = {
        "id": attendee.id,
        "tenant_id": attendee.tenant_id,
        "application_id": attendee.application_id,
        "popup_id": attendee.popup_id,
        "human_id": attendee.human_id,
        "name": attendee.name,
        "category_id": attendee.category_id,
        "category": attendee.category,
        "email": attendee.email,
        "gender": attendee.gender,
        "check_in_code": attendee.check_in_code,
        "poap_url": attendee.poap_url,
        "created_at": getattr(attendee, "created_at", None),
        "updated_at": getattr(attendee, "updated_at", None),
    }
    return AttendeeWithOriginPublic(**base, products=ticket_products, origin=origin)


# ---------------------------------------------------------------------------
# Portal human-scoped attendee endpoints (CAP-B, CAP-C)
# ---------------------------------------------------------------------------


@router.get(
    "/my/popup/{popup_id}",
    response_model=ListModel[AttendeeWithOriginPublic],
    tags=["portal"],
    summary="List your attendees for a popup",
)
@scope_route("portal:directory_read")
async def list_my_attendees_by_popup(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _scope: RequireHumanScopeDirectoryRead,
    skip: PaginationSkip = 0,
    limit: _AttendeeLimit = 50,
) -> ListModel[AttendeeWithOriginPublic]:
    """List all attendees owned by the current Human for a specific popup.

    Returns both application-linked and direct-sale attendees, each with an
    `origin` discriminator. Empty result is valid (not 404).
    Requires OTP-authenticated Human token.
    """
    attendees, total = crud.attendees_crud.find_by_human_popup(
        db, human_id=current_human.id, popup_id=popup_id, skip=skip, limit=limit
    )
    # Single aggregation across every ticket on the page so the portal can flag
    # already-scanned QR codes without N+1 lookups per attendee.
    ticket_ids = [ap.id for a in attendees for ap in a.attendee_products]
    last_scan_by_ticket = get_last_scan_by_tickets(db, ticket_ids)
    results = [_build_attendee_with_origin(a, last_scan_by_ticket) for a in attendees]
    return ListModel[AttendeeWithOriginPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/my/popup/{popup_id}",
    response_model=AttendeeWithOriginPublic,
    tags=["portal"],
    summary="Create a companion attendee",
)
@scope_route("portal:self_read")
async def create_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_in: AttendeeCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _scope: RequireHumanScopeSelfRead,
) -> AttendeeWithOriginPublic:
    """Create a companion attendee (spouse/child) for the current Human's application.

    Requires:
    - Application popup (sale_type check enforced as defense-in-depth)
    - Valid accepted Application for (current_human, popup_id)

    Returns 422 with code='application_required' if no application exists or the
    popup is not an application popup.
    """
    from app.api.application.crud import applications_crud
    from app.api.popup.models import Popups
    from app.api.shared.enums import SaleType

    # Validate popup exists and is an application popup
    popup = db.get(Popups, popup_id)
    if popup is None or getattr(popup, "sale_type", None) == SaleType.direct.value:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {
                    "code": "application_required",
                    "message": "This popup does not support application-based attendees",
                }
            ],
        )

    # Validate application exists for this human + popup
    application = applications_crud.get_by_human_popup(db, current_human.id, popup_id)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {
                    "code": "application_required",
                    "message": "No application found for this popup",
                }
            ],
        )

    # Validate category_id belongs to this popup (closes security hole per spec)
    from app.api.attendee_category.crud import attendee_categories_crud as cat_crud

    if attendee_in.category_id is not None:
        category_row = cat_crud.get(db, attendee_in.category_id)
        if category_row is None or category_row.popup_id != popup_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[
                    {
                        "code": "invalid_category",
                        "message": "Category does not belong to this popup",
                    }
                ],
            )
        if not category_row.enabled_in_passes_flow:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[
                    {
                        "code": "category_disabled",
                        "message": "This attendee type is not currently accepted",
                    }
                ],
            )
        if category_row.max_per_application is not None:
            from sqlmodel import func, select  # noqa: PLC0415

            from app.api.attendee.models import Attendees as _Attendees  # noqa: PLC0415

            count = db.exec(
                select(func.count()).where(
                    _Attendees.application_id == application.id,
                    _Attendees.category_id == category_row.id,
                )
            ).one()
            if count >= category_row.max_per_application:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=[
                        {
                            "code": "max_reached",
                            "message": f"Limit of {category_row.max_per_application} reached for this category",
                        }
                    ],
                )
        # Derive legacy category string from FK for backward compatibility
        effective_category = category_row.key
        effective_category_id = category_row.id
    else:
        # Legacy fallback: category string provided directly (deprecated path)
        effective_category = attendee_in.category or "main"
        effective_category_id = None

    attendee = crud.attendees_crud.create_internal(
        session=db,
        tenant_id=application.tenant_id,
        application_id=application.id,
        popup_id=popup_id,
        name=attendee_in.name,
        category=effective_category,
        category_id=effective_category_id,
        email=attendee_in.email,
        gender=attendee_in.gender,
    )

    last_scan_by_ticket = get_last_scan_by_tickets(
        db, [ap.id for ap in attendee.attendee_products]
    )
    return _build_attendee_with_origin(attendee, last_scan_by_ticket)


@router.patch(
    "/my/popup/{popup_id}/{attendee_id}",
    response_model=AttendeeWithOriginPublic,
    tags=["portal"],
    summary="Update your attendee",
)
@scope_route("portal:self_read")
async def update_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _scope: RequireHumanScopeSelfRead,
) -> AttendeeWithOriginPublic:
    """Update a companion attendee using the dual-path auth predicate.

    Authorization: attendee.popup_id == popup_id AND (
        attendee.human_id == current_human.id
        OR attendee.application.human_id == current_human.id
    ).
    Returns 404 if attendee not found, popup_id mismatch, or predicate fails
    (do not expose existence to unauthorized callers).
    """
    from app.api.application.models import Applications

    attendee = crud.attendees_crud.get(db, attendee_id)

    if attendee is None or attendee.popup_id != popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attendee not found"
        )

    # Dual-path auth predicate
    owned = attendee.human_id == current_human.id
    if not owned and attendee.application_id is not None:
        application = db.get(Applications, attendee.application_id)
        owned = application is not None and application.human_id == current_human.id

    if not owned:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attendee not found"
        )

    # Validate category change (blocked if attendee has products)
    update_dict = attendee_in.model_dump(exclude_unset=True)
    if "category" in update_dict and attendee.has_products():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change category for an attendee with purchased products",
        )

    updated = crud.attendees_crud.update_attendee(db, attendee, attendee_in)
    last_scan_by_ticket = get_last_scan_by_tickets(
        db, [ap.id for ap in updated.attendee_products]
    )
    return _build_attendee_with_origin(updated, last_scan_by_ticket)


@router.delete(
    "/my/popup/{popup_id}/{attendee_id}",
    tags=["portal"],
    summary="Delete your attendee",
)
@scope_route("portal:self_read")
async def delete_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    _scope: RequireHumanScopeSelfRead,
) -> dict:
    """Delete a companion attendee using the dual-path auth predicate.

    Returns 404 if attendee not found or predicate fails.
    Returns 400 with code='attendee_has_products' if attendee has purchased products.
    """
    from app.api.application.models import Applications

    attendee = crud.attendees_crud.get(db, attendee_id)

    if attendee is None or attendee.popup_id != popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attendee not found"
        )

    # Dual-path auth predicate
    owned = attendee.human_id == current_human.id
    if not owned and attendee.application_id is not None:
        application = db.get(Applications, attendee.application_id)
        owned = application is not None and application.human_id == current_human.id

    if not owned:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attendee not found"
        )

    # delete_attendee raises 400 if attendee has products
    crud.attendees_crud.delete_attendee(db, attendee)
    return {"ok": True}


# Note: Most attendee operations are done through the application routes
# These routes are for direct BO access


@router.get("", response_model=ListModel[AttendeeListItem])
async def list_attendees(
    db: CheckInOrApiKeySession_AttendeesRead,
    _: CheckInOrApiKey_AttendeesRead,
    application_id: uuid.UUID | None = None,
    popup_id: uuid.UUID | None = None,
    email: str | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[AttendeeListItem]:
    """List attendees with optional filters (BO only).

    Returns AttendeeListItem (ProductWithQuantity shape) for compatibility with
    the existing BO list view. Use GET /attendees/{id} for the full
    AttendeePublic shape with typed AttendeeProductPublic tickets.
    """
    if application_id:
        attendees = crud.attendees_crud.find_by_application(db, application_id)
        total = len(attendees)
        attendees = attendees[skip : skip + limit]
    elif popup_id:
        attendees, total = crud.attendees_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search
        )
    elif email:
        attendees, total = crud.attendees_crud.find_by_email(
            db, email=email, skip=skip, limit=limit
        )
    else:
        attendees, total = crud.attendees_crud.find(
            db,
            skip=skip,
            limit=limit,
            search=search,
            search_fields=["name", "email"],
        )

    results = []
    for a in attendees:
        # Build product list — one row per ticket, quantity=1 per ticket
        products = []
        for ap in a.attendee_products:
            from app.api.product.schemas import ProductWithQuantity

            product = ProductWithQuantity.model_validate(ap.product)
            product.quantity = 1  # each ticket row = 1 unit
            products.append(product)

        attendee_data = AttendeeListItem.model_validate(a)
        attendee_data.products = products
        results.append(attendee_data)

    return ListModel[AttendeeListItem](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{attendee_id}", response_model=AttendeeWithOriginPublic)
async def get_attendee(
    attendee_id: uuid.UUID,
    db: CheckInOrApiKeySession_AttendeesRead,
    _: CheckInOrApiKey_AttendeesRead,
) -> AttendeeWithOriginPublic:
    """Get a single attendee with full ticket details (BO only).

    Returns AttendeeWithOriginPublic so each products entry is an
    AttendeeProductPublic with check_in_code, payment_id, and
    requires_check_in populated. The origin discriminator is also
    included ('application' | 'direct_sale').
    """
    attendee = crud.attendees_crud.get(db, attendee_id)

    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    last_scan_by_ticket = get_last_scan_by_tickets(
        db, [ap.id for ap in attendee.attendee_products]
    )
    return _build_attendee_with_origin(attendee, last_scan_by_ticket)


@router.patch("/{attendee_id}", response_model=AttendeeWithOriginPublic)
async def update_attendee(
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: AdminOrApiKeySession_AttendeesWrite,
    _current_user: AdminOrApiKey_AttendeesWrite,
) -> AttendeeWithOriginPublic:
    """Update an attendee (BO only)."""

    attendee = crud.attendees_crud.get(db, attendee_id)
    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    updated = crud.attendees_crud.update_attendee(db, attendee, attendee_in)
    last_scan_by_ticket = get_last_scan_by_tickets(
        db, [ap.id for ap in updated.attendee_products]
    )
    return _build_attendee_with_origin(updated, last_scan_by_ticket)


@router.delete("/{attendee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attendee(
    attendee_id: uuid.UUID,
    db: AdminOrApiKeySession_AttendeesWrite,
    _current_user: AdminOrApiKey_AttendeesWrite,
) -> None:
    """Delete an attendee (BO only)."""

    attendee = crud.attendees_crud.get(db, attendee_id)
    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    # Cannot delete main attendee
    if attendee.category == "main":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete main attendee",
        )

    crud.attendees_crud.delete_attendee(db, attendee)


@router.post("/check-in/{code}", response_model=TicketPublic)
async def post_check_in(
    code: str,
    payload: CheckInPayload,
    db: TenantSession,
    current_user: CurrentCheckInOperator,
    popup_id: Annotated[
        uuid.UUID,
        Query(description="Popup the scanner is operating in"),
    ],
) -> TicketPublic:
    """Record a check-in event and return enriched TicketPublic (BO - scanner endpoint).

    POST replaces the former GET — the endpoint now mutates state by inserting a
    ticket_events row on every scan. This enables full scan history so frontend/staff
    can apply the right policy at runtime (single-scan, scan-every-time, etc.).

    The scanner MUST send `popup_id` (the popup it is operating in). The endpoint
    rejects codes that belong to a different popup, mirroring how every other
    popup-scoped route is non-cross.

    Returns:
      - 200 with TicketPublic + scan summary. Backend always records the new
        event; the frontend can detect a re-scan via `total_scans > 1` and
        surface a warning (policy is frontend's responsibility).
      - 400 if the product does not require check-in (`requires_check_in=false`)
      - 404 if check_in_code not found OR the ticket belongs to a different popup

    Code is matched case-insensitively (uppercased before lookup).
    """
    result = crud.attendees_crud.get_by_check_in_code(db, code.upper())

    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found",
        )

    ticket, attendee, product = result

    # Reject codes from a different popup. We treat cross-popup access as
    # "not found" rather than a distinct error to keep the response uniform
    # with the way every other popup-scoped route handles non-matching rows.
    if attendee.popup_id != popup_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found",
        )

    # Reject codes belonging to non-scannable products (e.g. merch, lodging).
    # The migration generates a check_in_code for every attendee_products row to
    # keep the column NOT NULL, but only `requires_check_in=true` products are
    # legitimate scan targets.
    if not product.requires_check_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product does not require check-in",
        )

    # Record the check-in event; actor is the current user
    record_check_in(
        db,
        attendee_product_id=ticket.id,
        popup_id=popup_id,
        payload=payload,
        actor_user_id=current_user.id,
    )

    # Build scan summary from ticket_events (single aggregation query).
    summary = get_check_in_summary(db, ticket.id)

    return TicketPublic(
        id=ticket.id,
        check_in_code=ticket.check_in_code,
        payment_id=ticket.payment_id,
        attendee=TicketAttendeeSnapshot(
            id=attendee.id,
            name=attendee.name,
            email=attendee.email,
            category=attendee.category,
        ),
        product=TicketProductSnapshot(
            id=product.id,
            name=product.name,
            price=float(product.price),
            category=product.category,
        ),
        total_scans=summary["total_scans"],
        first_scan_at=summary["first_scan_at"],
        last_scan_at=summary["last_scan_at"],
    )


@router.get("/tickets/{email}", response_model=list[AttendeeWithTickets])
async def get_tickets_by_email(
    email: str,
    db: TenantSession,
    _: CurrentCheckInOperator,
) -> list[AttendeeWithTickets]:
    """Get all tickets/products for an email across all events (BO).

    Returns one AttendeeWithTickets per attendee row. Each AttendeeProducts row
    (ticket) is flattened into a TicketProduct entry with quantity=1.
    Handles both application-linked and direct-sale attendees.
    """
    attendees, _ = crud.attendees_crud.find_by_email(db, email=email, limit=1000)  # type: ignore[assignment]

    results = []
    for attendee in attendees:
        if not attendee.attendee_products:
            continue

        # Resolve popup — direct-sale attendees have attendee.popup directly
        # Application-linked attendees may have attendee.application.popup
        popup = None
        if attendee.popup_id:
            from app.api.popup.models import Popups

            popup = db.get(Popups, attendee.popup_id)
        if popup is None and attendee.application:
            popup = attendee.application.popup
        popup_name = popup.name if popup else "Unknown"

        # Per-ticket entries — one TicketProduct per AttendeeProducts row
        ticket_products = []
        for ap in attendee.attendee_products:
            ticket_products.append(
                TicketProduct(
                    name=ap.product.name,
                    category=ap.product.category,
                    quantity=1,  # each row = 1 ticket
                )
            )

        results.append(
            AttendeeWithTickets(
                id=attendee.id,
                name=attendee.name,
                email=attendee.email,
                category=attendee.category,
                check_in_code=attendee.check_in_code,
                popup_id=popup.id if popup else attendee.popup_id,
                popup_name=popup_name,
                popup_slug=popup.slug if popup else None,
                products=ticket_products,
            )
        )

    return results
