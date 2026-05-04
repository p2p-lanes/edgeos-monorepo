import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.attendee import crud
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeeProductPublic,
    AttendeePublic,
    AttendeeUpdate,
    AttendeeWithOriginPublic,
    AttendeeWithTickets,
    TicketProduct,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/attendees", tags=["attendees"])

# Pagination type for portal attendees endpoint (max 100 per page)
_AttendeeLimit = Annotated[
    int, Query(ge=1, le=100, description="Max attendees to return")
]


def _build_attendee_with_origin(attendee) -> AttendeeWithOriginPublic:
    """Build an AttendeeWithOriginPublic from an Attendees ORM row."""
    products = [
        AttendeeProductPublic(
            attendee_id=ap.attendee_id,
            product_id=ap.product_id,
            quantity=ap.quantity,
        )
        for ap in attendee.attendee_products
    ]
    origin = "application" if attendee.application_id is not None else "direct_sale"
    result = AttendeeWithOriginPublic.model_validate(attendee)
    result.products = products  # type: ignore[assignment]
    result.origin = origin
    return result


# ---------------------------------------------------------------------------
# Portal human-scoped attendee endpoints (CAP-B, CAP-C)
# ---------------------------------------------------------------------------


@router.get(
    "/my/popup/{popup_id}",
    response_model=ListModel[AttendeeWithOriginPublic],
    tags=["portal"],
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
        db, human_id=current_human.id, popup_id=popup_id, skip=skip, limit=limit
    )
    results = [_build_attendee_with_origin(a) for a in attendees]
    return ListModel[AttendeeWithOriginPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/my/popup/{popup_id}",
    response_model=AttendeeWithOriginPublic,
    tags=["portal"],
)
async def create_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_in: AttendeeCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> AttendeeWithOriginPublic:
    """Create a companion attendee (spouse/child) for the current Human's application.

    Requires:
    - Application popup (sale_type check enforced as defense-in-depth)
    - Valid accepted Application for (current_human, popup_id)

    Returns 422 with code='application_required' if no application exists or the
    popup is not an application popup.
    """
    from app.api.application.crud import applications_crud
    from app.api.attendee.crud import generate_check_in_code
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

    prefix = popup.slug[:3].upper() if popup.slug else ""
    check_in_code = generate_check_in_code(prefix)

    attendee = crud.attendees_crud.create_internal(
        session=db,
        tenant_id=application.tenant_id,
        application_id=application.id,
        popup_id=popup_id,
        name=attendee_in.name,
        category=attendee_in.category,
        check_in_code=check_in_code,
        email=attendee_in.email,
        gender=attendee_in.gender,
    )

    return _build_attendee_with_origin(attendee)


@router.patch(
    "/my/popup/{popup_id}/{attendee_id}",
    response_model=AttendeeWithOriginPublic,
    tags=["portal"],
)
async def update_my_attendee_for_popup(
    popup_id: uuid.UUID,
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
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
    return _build_attendee_with_origin(updated)


@router.delete(
    "/my/popup/{popup_id}/{attendee_id}",
    tags=["portal"],
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


@router.get("", response_model=ListModel[AttendeePublic])
async def list_attendees(
    db: TenantSession,
    _: CurrentUser,
    application_id: uuid.UUID | None = None,
    popup_id: uuid.UUID | None = None,
    email: str | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[AttendeePublic]:
    """List attendees with optional filters (BO only)."""
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
        # Build product list with quantities
        products = []
        for ap in a.attendee_products:
            from app.api.product.schemas import ProductWithQuantity

            product = ProductWithQuantity.model_validate(ap.product)
            product.quantity = ap.quantity
            products.append(product)

        attendee_data = AttendeePublic.model_validate(a)
        attendee_data.products = products
        results.append(attendee_data)

    return ListModel[AttendeePublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{attendee_id}", response_model=AttendeePublic)
async def get_attendee(
    attendee_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> AttendeePublic:
    """Get a single attendee (BO only)."""
    attendee = crud.attendees_crud.get(db, attendee_id)

    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    # Build product list with quantities
    products = []
    for ap in attendee.attendee_products:
        from app.api.product.schemas import ProductWithQuantity

        product_data = ap.product.model_dump()
        product_data["quantity"] = ap.quantity
        products.append(ProductWithQuantity(**product_data))

    result = AttendeePublic.model_validate(attendee)
    result.products = products
    return result


@router.patch("/{attendee_id}", response_model=AttendeePublic)
async def update_attendee(
    attendee_id: uuid.UUID,
    attendee_in: AttendeeUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> AttendeePublic:
    """Update an attendee (BO only)."""

    attendee = crud.attendees_crud.get(db, attendee_id)
    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    updated = crud.attendees_crud.update_attendee(db, attendee, attendee_in)

    # Build product list
    products = []
    for ap in updated.attendee_products:
        from app.api.product.schemas import ProductWithQuantity

        product_data = ap.product.model_dump()
        product_data["quantity"] = ap.quantity
        products.append(ProductWithQuantity(**product_data))

    result = AttendeePublic.model_validate(updated)
    result.products = products
    return result


@router.delete("/{attendee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attendee(
    attendee_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
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


@router.get("/check-in/{code}", response_model=AttendeePublic)
async def get_by_check_in_code(
    code: str,
    db: TenantSession,
    _: CurrentUser,
) -> AttendeePublic:
    """Get attendee by check-in code (BO - for check-in process)."""
    attendee = crud.attendees_crud.get_by_check_in_code(db, code.upper())

    if not attendee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendee not found",
        )

    # Build product list with quantities
    products = []
    for ap in attendee.attendee_products:
        from app.api.product.schemas import ProductWithQuantity

        product_data = ap.product.model_dump()
        product_data["quantity"] = ap.quantity
        products.append(ProductWithQuantity(**product_data))

    result = AttendeePublic.model_validate(attendee)
    result.products = products
    return result


@router.get("/tickets/{email}", response_model=list[AttendeeWithTickets])
async def get_tickets_by_email(
    email: str,
    db: TenantSession,
    _: CurrentUser,
) -> list[AttendeeWithTickets]:
    """Get all tickets/products for an email across all events (BO)."""
    attendees, _ = crud.attendees_crud.find_by_email(db, email=email, limit=1000)  # type: ignore[assignment]

    results = []
    for attendee in attendees:
        if not attendee.attendee_products:
            continue

        # Get popup through application
        popup = attendee.application.popup
        popup_name = popup.name if popup else "Unknown"

        ticket_products = []
        for ap in attendee.attendee_products:
            ticket_products.append(
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
                popup_id=popup.id if popup else attendee.application.popup_id,
                popup_name=popup_name,
                popup_slug=popup.slug if popup else None,
                products=ticket_products,
            )
        )

    return results
