import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import select

from app.api.attendee import crud
from app.api.attendee.models import AttendeeProducts
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeeListItem,
    AttendeeProductPublic,
    AttendeeTicketAdd,
    AttendeeTicketMetadataUpdate,
    AttendeeTicketProductSwap,
    AttendeeUpdate,
    AttendeeWithOriginPublic,
    AttendeeWithTickets,
    TicketAttendeeSnapshot,
    TicketProduct,
    TicketProductSnapshot,
    TicketPublic,
    parse_attendee_filters,
)
from app.api.audit_log.actor import actor_from_user
from app.api.check_in.crud import (
    get_check_in_summary,
    get_last_scan_by_tickets,
    record_check_in,
)
from app.api.check_in.schemas import CheckInPayload
from app.api.product.models import Products
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_AttendeesWrite,
    AdminOrApiKeySession_AttendeesWrite,
    CheckInOrApiKey_AttendeesRead,
    CheckInOrApiKeySession_AttendeesRead,
    CurrentCheckInOperator,
    CurrentHuman,
    HumanTenantSession,
    TenantSession,
    needs,
)
from app.core.logging import get_request_id

router = APIRouter(prefix="/attendees", tags=["attendees"])


class StaffTicketPublic(TicketPublic):
    attendee: TicketAttendeeSnapshot | None = None


# Pagination type for portal attendees endpoint (max 100 per page)
_AttendeeLimit = Annotated[
    int, Query(ge=1, le=100, description="Max attendees to return")
]


def _validate_required_fields(
    required_fields: list[dict],
    additional_data: dict,
) -> None:
    """Validate declarative required_fields against submitted additional_data.

    For each field marked ``required``, ensure a non-empty value is present. For
    fields typed ``"date"``, also ensure the value parses as an ISO date when
    present. Extra keys in additional_data are permitted (unknown keys are kept,
    not rejected) so partial/extra answers do not break the flow. Raises 422 with
    the offending field name on the first failure.
    """
    from datetime import date as _date

    data = additional_data or {}
    for field in required_fields or []:
        name = field.get("name")
        if not name:
            continue
        value = data.get(name)
        if field.get("required") and (value is None or value == ""):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[
                    {
                        "code": "required_field_missing",
                        "field": name,
                        "message": f"Missing required field '{name}'",
                    }
                ],
            )
        if field.get("type") == "date" and value not in (None, ""):
            try:
                _date.fromisoformat(str(value))
            except (ValueError, TypeError):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=[
                        {
                            "code": "invalid_date",
                            "field": name,
                            "message": (
                                f"Field '{name}' must be an ISO date (YYYY-MM-DD)"
                            ),
                        }
                    ],
                ) from None


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
            product_name = snapshot.product_name or (
                ap.product.name if ap.product else None
            )
            # "" snapshots are a backend artifact (crud writes product.category
            # or "") and break portal icon resolution — treat them like a
            # missing snapshot and fall back to the live product category.
            product_category = snapshot.product_category or (
                ap.product.category if ap.product else None
            )
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
                purchase_metadata=ap.purchase_metadata,
                product_category_snapshot=ap.product_category_snapshot,
                requires_check_in_snapshot=ap.requires_check_in_snapshot,
                revoked_at=ap.revoked_at,
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
        "poap_url": attendee.poap_url,
        "additional_data": getattr(attendee, "additional_data", None) or {},
        "created_at": getattr(attendee, "created_at", None),
        "updated_at": getattr(attendee, "updated_at", None),
    }
    return AttendeeWithOriginPublic(**base, products=ticket_products, origin=origin)


def _attendee_response(db, attendee_id: uuid.UUID) -> AttendeeWithOriginPublic:
    """Re-fetch an attendee and build its full response after a mutation.

    Used by the admin ticket-management routes so the panel receives the
    refreshed attendee (with up-to-date tickets) in a single round-trip.
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


def _get_my_attendee(
    db,
    *,
    attendee_id: uuid.UUID,
    popup_id: uuid.UUID,
    current_human,
):
    attendee = crud.attendees_crud.get_for_human_popup(
        db,
        attendee_id=attendee_id,
        human_id=current_human.id,
        popup_id=popup_id,
        tenant_id=current_human.tenant_id,
    )
    if attendee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )
    return attendee


# ---------------------------------------------------------------------------
# Portal human-scoped attendee endpoints (CAP-B, CAP-C)
# ---------------------------------------------------------------------------


@router.get(
    "/my/popup/{popup_id}",
    response_model=ListModel[AttendeeWithOriginPublic],
    tags=["portal"],
    summary="List your attendees for a popup",
    dependencies=[needs("portal:applications:read")],
)
async def list_my_attendees_by_popup(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    skip: PaginationSkip = 0,
    limit: _AttendeeLimit = 50,
) -> ListModel[AttendeeWithOriginPublic]:
    """List all attendees owned by the current Human for a specific popup.

    Returns both application-linked and direct-sale attendees, each with an
    `origin` discriminator. Empty result is valid (not 404).
    Requires OTP-authenticated Human token.
    """
    attendees, total = crud.attendees_crud.find_by_human_popup(
        db,
        human_id=current_human.id,
        popup_id=popup_id,
        skip=skip,
        limit=limit,
        tenant_id=current_human.tenant_id,
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
    dependencies=[needs("portal:attendees:write")],
)
async def create_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_in: AttendeeCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> AttendeeWithOriginPublic:
    """Create a companion attendee (spouse/child) for the current Human's application.

    Requires:
    - A gathering where somebody applies (defense-in-depth; the application
      lookup below is the real gate)
    - Valid accepted Application for (current_human, popup_id)

    Returns 422 with code='application_required' if no application exists or
    nobody applies to this gathering at all.
    """
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Companion attendees are created after approval",
    )

    from app.api.application.crud import applications_crud
    from app.api.popup.guards import ensure_popup_writable
    from app.api.popup.models import Popups
    from app.api.sales_flow.crud import popup_takes_applications

    # Asked of the doors: a gathering that sells through its main way in can
    # still review applicants through another, and those applicants are
    # entitled to bring a companion.
    popup = db.get(Popups, popup_id)
    if popup is None or not popup_takes_applications(db, popup_id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {
                    "code": "application_required",
                    "message": "This popup does not support application-based attendees",
                }
            ],
        )

    ensure_popup_writable(popup)

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
            count = crud.attendees_crud.count_party_by_category(
                db,
                human_id=current_human.id,
                popup_id=popup_id,
                category_id=category_row.id,
                tenant_id=current_human.tenant_id,
            )
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
        # Validate declarative required_fields (e.g. a kid's date_of_birth) are
        # present in the submitted additional_data. Permissive toward extra keys.
        _validate_required_fields(
            category_row.required_fields or [],
            attendee_in.additional_data or {},
        )
        # Derive legacy category string from FK for backward compatibility
        effective_category = category_row.key
        effective_category_id = category_row.id
    else:
        # Legacy fallback: category string provided directly (deprecated path)
        effective_category = attendee_in.category or "main"
        effective_category_id = None

    # The mirror of the 409 that stops a companion creating their own
    # application (`application/router.py`). That one guards the direction
    # where the companion acts; this guards the direction where someone
    # acts on them.
    #
    # `create_internal` associates by email — it finds the Human with that
    # address and stamps their id on the row. Adding someone who is already at
    # this gathering would give one person two attendee records: two QR codes,
    # two directory entries, and stock spendable twice
    # (sdd/sales-flows-rediseno).
    if attendee_in.email:
        existing_human_id = crud.attendees_crud._find_human_id_by_email(
            db, attendee_in.email, application.tenant_id
        )
        if existing_human_id is not None and crud.attendees_crud.human_attends_popup(
            db, existing_human_id, popup_id
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This person is already attending this event.",
            )

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
        additional_data=attendee_in.additional_data,
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
    dependencies=[needs("portal:attendees:write")],
)
async def update_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> AttendeeWithOriginPublic:
    """Update a self, explicitly managed, or legacy-owned Attendee."""
    attendee = _get_my_attendee(
        db,
        attendee_id=attendee_id,
        popup_id=popup_id,
        current_human=current_human,
    )

    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, popup_id))

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


@router.patch(
    "/my/popup/{popup_id}/{attendee_id}/tickets/{ticket_id}/meal-plan",
    response_model=AttendeeWithOriginPublic,
    tags=["portal"],
    summary="Edit your meal-plan ticket choices",
    dependencies=[needs("portal:attendees:write")],
)
async def update_my_meal_plan_ticket(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    ticket_id: uuid.UUID,
    body: AttendeeTicketMetadataUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> AttendeeWithOriginPublic:
    """Edit a purchased meal-plan ticket's per-day choices (portal, no payment).

    Mutates only AttendeeProducts.purchase_metadata (daily_choices,
    dietary_restriction, special_request) for a week whose sale window is still
    open. Does not change products, price, stock, or the payment snapshot.

    Authorization uses the same centralized self-or-manager compatibility
    predicate as all other portal Attendee operations.

    Errors from the CRUD layer: 404 (ticket/product not found), 409
    meal_plan_week_locked (week closed), 422 not_meal_plan_ticket or
    invalid_meal_plan_choice.
    """
    _get_my_attendee(
        db,
        attendee_id=attendee_id,
        popup_id=popup_id,
        current_human=current_human,
    )

    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, popup_id))

    crud.attendees_crud.update_ticket_metadata(
        db,
        attendee_id=attendee_id,
        ticket_id=ticket_id,
        choices=body,
    )

    return _attendee_response(db, attendee_id)


@router.delete(
    "/my/popup/{popup_id}/{attendee_id}",
    tags=["portal"],
    summary="Delete your attendee",
    dependencies=[needs("portal:attendees:write")],
)
async def delete_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> dict:
    """Delete a companion attendee using the dual-path auth predicate.

    Returns 404 if attendee not found or predicate fails.
    Returns 400 with code='attendee_has_products' if attendee has purchased products.
    """
    attendee = _get_my_attendee(
        db,
        attendee_id=attendee_id,
        popup_id=popup_id,
        current_human=current_human,
    )

    from app.api.popup.crud import popups_crud
    from app.api.popup.guards import ensure_popup_writable

    ensure_popup_writable(popups_crud.get(db, popup_id))

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
    has_tickets: bool | None = None,
    category_id: uuid.UUID | None = None,
    filters: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[AttendeeListItem]:
    """List attendees with optional filters (BO only).

    Returns AttendeeListItem (ProductWithQuantity shape) for compatibility with
    the existing BO list view. Use GET /attendees/{id} for the full
    AttendeePublic shape with typed AttendeeProductPublic tickets.

    has_tickets (only honored on the popup_id path) keeps attendees with at
    least one purchased/granted ticket when True, those without when False.

    ``filters`` is a JSON filter group (only honored on the popup_id path):
    ``{"match": "all"|"any", "conditions": [{"field", "op", "value"}]}``.
    It is combined (AND) with the legacy search/has_tickets/category_id
    params. ``has_tickets`` is also available as a virtual filter field.
    """
    parsed_filters = parse_attendee_filters(filters)
    if application_id:
        attendees, total = crud.attendees_crud.find_by_application(
            db, application_id, skip=skip, limit=limit
        )
    elif popup_id:
        attendees, total = crud.attendees_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            search=search,
            has_tickets=has_tickets,
            category_id=category_id,
            filters=parsed_filters,
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


@router.post(
    "/{attendee_id}/tickets",
    response_model=AttendeeWithOriginPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Add a ticket to an attendee",
)
async def add_attendee_ticket(
    attendee_id: uuid.UUID,
    body: AttendeeTicketAdd,
    db: AdminOrApiKeySession_AttendeesWrite,
    current_user: AdminOrApiKey_AttendeesWrite,
) -> AttendeeWithOriginPublic:
    """Add tickets (N products × quantity) to an existing attendee (BO only).

    Admin grant with no payment: tickets are materialized with payment_id NULL
    (manual emission) and stock is decremented like any other purchase path.
    Each product must be active and belong to the attendee's popup; the batch is
    applied atomically (a sold-out product rolls the whole add back with 409).
    """
    attendee = crud.attendees_crud.get(db, attendee_id)
    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    crud.attendees_crud.add_products(
        db,
        attendee_id=attendee_id,
        items=[(line.product_id, line.quantity) for line in body.items],
        tenant_id=attendee.tenant_id,
        actor=actor_from_user(current_user),
        grant_key=get_request_id(),
    )

    return _attendee_response(db, attendee_id)


@router.patch(
    "/{attendee_id}/tickets/{ticket_id}/product",
    response_model=AttendeeWithOriginPublic,
    summary="Change the product of an attendee's ticket",
)
async def swap_attendee_ticket_product(
    attendee_id: uuid.UUID,
    ticket_id: uuid.UUID,
    body: AttendeeTicketProductSwap,
    db: AdminOrApiKeySession_AttendeesWrite,
    current_user: AdminOrApiKey_AttendeesWrite,
) -> AttendeeWithOriginPublic:
    """Swap the product of a single ticket (BO only, no payment).

    Restores one unit of the old product's stock and decrements the new one
    (409 if sold out). The ticket keeps its check_in_code. Cross-popup swaps are
    rejected with 422.
    """
    crud.attendees_crud.swap_ticket_product(
        db,
        attendee_id=attendee_id,
        ticket_id=ticket_id,
        new_product_id=body.product_id,
        actor=actor_from_user(current_user),
    )

    return _attendee_response(db, attendee_id)


@router.delete(
    "/{attendee_id}/tickets/{ticket_id}",
    response_model=AttendeeWithOriginPublic,
    summary="Remove a ticket from an attendee",
)
async def remove_attendee_ticket(
    attendee_id: uuid.UUID,
    ticket_id: uuid.UUID,
    db: AdminOrApiKeySession_AttendeesWrite,
    current_user: AdminOrApiKey_AttendeesWrite,
) -> AttendeeWithOriginPublic:
    """Remove a single ticket from an attendee (BO only).

    Restores one unit of the product's stock to the pool. Returns the updated
    attendee so the panel can refresh.
    """
    crud.attendees_crud.remove_product(
        db,
        attendee_id=attendee_id,
        ticket_id=ticket_id,
        actor=actor_from_user(current_user),
    )

    return _attendee_response(db, attendee_id)


@router.post("/check-in/{code}", response_model=StaffTicketPublic)
async def post_check_in(
    code: str,
    payload: CheckInPayload,
    db: TenantSession,
    current_user: CurrentCheckInOperator,
    popup_id: Annotated[
        uuid.UUID,
        Query(description="Popup the scanner is operating in"),
    ],
) -> StaffTicketPublic:
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
    ticket = db.exec(
        select(AttendeeProducts)
        .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
        .where(
            AttendeeProducts.check_in_code == code.upper(),
            AttendeeProducts.revoked_at.is_(None),
            Products.popup_id == popup_id,
        )
        .with_for_update(of=AttendeeProducts)
    ).first()

    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticket not found",
        )

    attendee = ticket.attendee
    product = ticket.product

    # Reject codes belonging to non-scannable products (e.g. merch, lodging).
    # The migration generates a check_in_code for every attendee_products row to
    # keep the column NOT NULL, but only `requires_check_in=true` products are
    # legitimate scan targets.
    if ticket.requires_check_in_snapshot is not True:
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

    return StaffTicketPublic(
        id=ticket.id,
        check_in_code=ticket.check_in_code,
        payment_id=ticket.payment_id,
        attendee=(
            TicketAttendeeSnapshot.model_validate(attendee) if attendee else None
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
        # Both relationships are eager-loaded by find_by_email.
        popup = attendee.popup
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
                popup_id=popup.id if popup else attendee.popup_id,
                popup_name=popup_name,
                popup_slug=popup.slug if popup else None,
                products=ticket_products,
            )
        )

    return results
