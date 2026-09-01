"""Backoffice API for lodging inventory.

Route order matters here: every static segment (``/properties``,
``/bookings``, ``/calendar``, ``/images``, ``/units``, ``/price-rules``,
``/export.csv``, ``/bulk-*``) is declared **before** ``/{accommodation_id}``,
otherwise the catch-all swallows them.

Auth follows the products pattern: an admin JWT or an API key carrying
``accommodations:read`` / ``accommodations:write``. Every write resolves the
tenant from the popup when the caller is a superadmin, and popup scoping is
checked explicitly: RLS isolates tenants, not popups.
"""

import uuid
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlmodel import col, select

from app.api.accommodation import crud
from app.api.accommodation.availability import (
    AccommodationUnavailableError,
    availability_by_accommodation,
    check_stay_allowed,
    create_booking,
)
from app.api.accommodation.calendar import build_calendar
from app.api.accommodation.constants import BookingStatus
from app.api.accommodation.export import export_bookings_csv, export_filename
from app.api.accommodation.models import (
    AccommodationBookings,
    AccommodationImages,
    AccommodationPriceRules,
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.accommodation.schemas import (
    AccommodationAvailability,
    AccommodationBlockRange,
    AccommodationBookingCreate,
    AccommodationBookingPublic,
    AccommodationBookingUpdate,
    AccommodationBulkPrice,
    AccommodationBulkUpdateRequest,
    AccommodationCalendar,
    AccommodationCreate,
    AccommodationDuplicate,
    AccommodationImageCreate,
    AccommodationImagePublic,
    AccommodationPriceRuleCreate,
    AccommodationPriceRulePublic,
    AccommodationPriceRuleUpdate,
    AccommodationPropertyCreate,
    AccommodationPropertyPublic,
    AccommodationPropertyUpdate,
    AccommodationPublic,
    AccommodationUnitBulkCreate,
    AccommodationUnitPublic,
    AccommodationUnitUpdate,
    AccommodationUpdate,
    BlockRangeResult,
    BulkResult,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_AccommodationsRead,
    AdminOrApiKey_AccommodationsWrite,
    AdminOrApiKeySession_AccommodationsRead,
    AdminOrApiKeySession_AccommodationsWrite,
)

router = APIRouter(prefix="/accommodations", tags=["accommodations"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _not_found(what: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found"
    )


def _resolve_tenant_id(db, current_user, popup_id: uuid.UUID) -> uuid.UUID:
    """Tenant of the popup for a superadmin, own tenant for everyone else."""
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, popup_id)
        if not popup:
            raise _not_found("Popup")
        return popup.tenant_id
    return current_user.tenant_id


def _active_units_statement(accommodation_id: uuid.UUID):
    """Units of a room type in assignment order (used by block-range)."""
    return (
        select(AccommodationUnits)
        .where(
            AccommodationUnits.accommodation_id == accommodation_id,
            col(AccommodationUnits.is_active).is_(True),
        )
        .order_by(col(AccommodationUnits.sort_order), col(AccommodationUnits.label))
    )


def _get_property(db, property_id: uuid.UUID) -> AccommodationProperties:
    row = db.get(AccommodationProperties, property_id)
    if row is None:
        raise _not_found("Property")
    return row


def _get_accommodation(db, accommodation_id: uuid.UUID) -> Accommodations:
    row = crud.accommodations_crud.get_live(db, accommodation_id)
    if row is None:
        raise _not_found("Accommodation")
    return row


def _to_public(db, accommodation: Accommodations) -> AccommodationPublic:
    """Serialise a room type with its units and photos.

    ``images`` is not a relationship on the model (the link table carries the
    ordering), so it is resolved here rather than in the schema.
    """
    data = AccommodationPublic.model_validate(accommodation).model_dump()
    data["units"] = [
        AccommodationUnitPublic.model_validate(unit).model_dump()
        for unit in sorted(accommodation.units, key=lambda u: (u.sort_order, u.label))
    ]
    data["images"] = [
        AccommodationImagePublic.model_validate(image).model_dump()
        for image in crud.accommodations_crud.images_for(db, accommodation.id)
    ]
    return AccommodationPublic.model_validate(data)


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


@router.get("/properties", response_model=ListModel[AccommodationPropertyPublic])
async def list_properties(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    active_only: bool = False,
    search: str | None = None,
) -> ListModel[AccommodationPropertyPublic]:
    """List the buildings/sites that hold rooms for a popup."""
    rows = crud.accommodation_properties_crud.find_by_popup(
        db, popup_id, active_only=active_only, search=search
    )
    return ListModel[AccommodationPropertyPublic](
        results=[AccommodationPropertyPublic.model_validate(row) for row in rows],
        paging=Paging(offset=0, limit=len(rows), total=len(rows)),
    )


@router.post(
    "/properties",
    response_model=AccommodationPropertyPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_property(
    property_in: AccommodationPropertyCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    current_user: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPropertyPublic:
    tenant_id = _resolve_tenant_id(db, current_user, property_in.popup_id)
    row = crud.accommodation_properties_crud.create_for_tenant(
        db, property_in, tenant_id
    )
    return AccommodationPropertyPublic.model_validate(row)


@router.get("/properties/{property_id}", response_model=AccommodationPropertyPublic)
async def get_property(
    property_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
) -> AccommodationPropertyPublic:
    return AccommodationPropertyPublic.model_validate(_get_property(db, property_id))


@router.patch("/properties/{property_id}", response_model=AccommodationPropertyPublic)
async def update_property(
    property_id: uuid.UUID,
    property_in: AccommodationPropertyUpdate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPropertyPublic:
    row = _get_property(db, property_id)
    updated = crud.accommodation_properties_crud.update(db, row, property_in)
    return AccommodationPropertyPublic.model_validate(updated)


@router.delete("/properties/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_property(
    property_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> Response:
    """Delete a property. Refused while it still holds room types.

    Deleting inventory that has bookings is out of scope for the MVP (C15),
    so the safe move is to make the caller empty it (or deactivate) first.

    Soft-deleted room types count: their rows still hold the FK, so removing
    the property under them would fail at the database instead of here.
    """
    row = _get_property(db, property_id)
    remaining = db.exec(
        select(Accommodations.id).where(Accommodations.property_id == row.id)
    ).first()
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This property still has room types. Delete or move them first, "
                "or deactivate the property instead."
            ),
        )
    crud.accommodation_properties_crud.delete(db, row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------


@router.get("/calendar", response_model=AccommodationCalendar)
async def get_calendar(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    date_from: date,
    date_to: date,
    property_id: uuid.UUID | None = None,
) -> AccommodationCalendar:
    """Property -> room type -> unit -> bookings for a date window.

    ``date_to`` is exclusive, like every range in this module.
    """
    if date_to <= date_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="date_to must be after date_from",
        )
    return build_calendar(
        db,
        popup_id=popup_id,
        date_from=date_from,
        date_to=date_to,
        property_id=property_id,
    )


# ---------------------------------------------------------------------------
# Availability (staff-side preview: same numbers the checkout will show)
# ---------------------------------------------------------------------------


@router.get("/availability", response_model=list[AccommodationAvailability])
async def get_availability(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    check_in: date,
    check_out: date,
    property_id: uuid.UUID | None = None,
) -> list[AccommodationAvailability]:
    if check_out <= check_in:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="check_out must be after check_in",
        )

    accommodations = crud.accommodations_crud.find_by_popup(
        db, popup_id, property_ids=[property_id] if property_id else None
    )
    counts = availability_by_accommodation(
        db, [row.id for row in accommodations], check_in, check_out
    )
    popup_min_stay = crud.accommodations_crud.popup_min_stay(db, popup_id)

    results: list[AccommodationAvailability] = []
    for accommodation in accommodations:
        reason = check_stay_allowed(
            accommodation, check_in, check_out, popup_min_stay=popup_min_stay
        )
        available = 0 if reason else counts.get(accommodation.id, 0)
        results.append(
            AccommodationAvailability(
                accommodation_id=accommodation.id,
                available=available,
                unavailable_reason=reason if reason else None,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


@router.get("/bookings", response_model=ListModel[AccommodationBookingPublic])
async def list_bookings(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    date_from: date,
    date_to: date,
    property_id: uuid.UUID | None = None,
    accommodation_id: uuid.UUID | None = None,
    statuses: list[BookingStatus] | None = Query(default=None),
    search: str | None = None,
) -> ListModel[AccommodationBookingPublic]:
    rows = crud.accommodation_bookings_crud.find_in_window(
        db,
        popup_id,
        date_from,
        date_to,
        property_id=property_id,
        accommodation_id=accommodation_id,
        statuses=[s.value for s in statuses] if statuses else None,
        search=search,
    )
    return ListModel[AccommodationBookingPublic](
        results=[AccommodationBookingPublic.model_validate(row) for row in rows],
        paging=Paging(offset=0, limit=len(rows), total=len(rows)),
    )


@router.post(
    "/bookings",
    response_model=AccommodationBookingPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_booking(
    booking_in: AccommodationBookingCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    current_user: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationBookingPublic:
    """Create a booking by hand: a comp, a phone reservation, a block.

    Staff bookings are ``confirmed`` immediately (there is no payment to
    wait for) and may ignore the min-stay / bookable-window restrictions,
    which exist to shape what guests can buy, not what staff can arrange.
    """
    accommodation = _get_accommodation(db, booking_in.accommodation_id)
    if accommodation.popup_id != booking_in.popup_id:
        raise _not_found("Accommodation")

    if not booking_in.ignore_restrictions:
        reason = check_stay_allowed(
            accommodation,
            booking_in.check_in,
            booking_in.check_out,
            popup_min_stay=crud.accommodations_crud.popup_min_stay(
                db, booking_in.popup_id
            ),
            guest_count=booking_in.guest_count,
        )
        if reason:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=reason
            )

    try:
        booking = create_booking(
            db,
            accommodation=accommodation,
            check_in=booking_in.check_in,
            check_out=booking_in.check_out,
            status=BookingStatus.CONFIRMED,
            kind=booking_in.kind,
            unit_id=booking_in.unit_id,
            guest_count=booking_in.guest_count,
            guests=[guest.model_dump(mode="json") for guest in booking_in.guests],
            primary_guest_name=booking_in.primary_guest_name,
            primary_guest_email=booking_in.primary_guest_email,
            notes=booking_in.notes,
            created_by_user_id=current_user.id,
        )
    except AccommodationUnavailableError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No unit is available for those dates",
        ) from None

    db.commit()
    db.refresh(booking)
    return AccommodationBookingPublic.model_validate(booking)


@router.post("/bookings/block-range", response_model=BlockRangeResult)
async def block_range(
    payload: AccommodationBlockRange,
    db: AdminOrApiKeySession_AccommodationsWrite,
    current_user: AdminOrApiKey_AccommodationsWrite,
) -> BlockRangeResult:
    """Take every unit of a room type off the market for a range.

    Units that are already booked are skipped, not failed: blocking a
    building for maintenance should not be refused because one guest is
    already staying; the operator sees the count and deals with that room.
    """
    accommodation = _get_accommodation(db, payload.accommodation_id)
    if accommodation.popup_id != payload.popup_id:
        raise _not_found("Accommodation")

    units = db.exec(
        _active_units_statement(accommodation.id),
    ).all()

    created: list[uuid.UUID] = []
    skipped = 0
    for unit in units:
        try:
            booking = create_booking(
                db,
                accommodation=accommodation,
                check_in=payload.check_in,
                check_out=payload.check_out,
                status=BookingStatus.CONFIRMED,
                kind=payload.kind,
                unit_id=unit.id,
                notes=payload.notes,
                created_by_user_id=current_user.id,
            )
        except AccommodationUnavailableError:
            skipped += 1
            continue
        created.append(booking.id)

    db.commit()
    return BlockRangeResult(created=len(created), skipped=skipped, booking_ids=created)


@router.patch("/bookings/{booking_id}", response_model=AccommodationBookingPublic)
async def update_booking(
    booking_id: uuid.UUID,
    booking_in: AccommodationBookingUpdate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationBookingPublic:
    """Reassign a unit, edit guests/notes, or cancel.

    A unit change is validated against the exclusion constraint by writing it
    and letting the database refuse; a 409 here means the target room is
    taken for those dates.
    """
    booking = db.get(AccommodationBookings, booking_id)
    if booking is None:
        raise _not_found("Booking")

    update_data = booking_in.model_dump(exclude_unset=True, exclude={"guests"})
    if booking_in.guests is not None:
        booking.guests = [guest.model_dump(mode="json") for guest in booking_in.guests]

    if "unit_id" in update_data and update_data["unit_id"] is not None:
        target = db.get(AccommodationUnits, update_data["unit_id"])
        if target is None or target.accommodation_id != booking.accommodation_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The target unit belongs to a different room type",
            )

    for field, value in update_data.items():
        setattr(booking, field, value)
    booking.updated_at = datetime.now(UTC)
    db.add(booking)

    try:
        db.commit()
    except Exception as exc:  # IntegrityError from the exclusion constraint
        db.rollback()
        if "uq_accommodation_bookings_no_overlap" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That unit is already booked for these dates",
            ) from None
        raise

    db.refresh(booking)
    return AccommodationBookingPublic.model_validate(booking)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


@router.get("/export.csv")
async def export_bookings(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    date_from: date,
    date_to: date,
    property_id: uuid.UUID | None = None,
    accommodation_id: uuid.UUID | None = None,
    statuses: list[BookingStatus] | None = Query(default=None),
    search: str | None = None,
) -> Response:
    """Same filters as the bookings list, rendered as CSV."""
    rows = crud.accommodation_bookings_crud.find_in_window(
        db,
        popup_id,
        date_from,
        date_to,
        property_id=property_id,
        accommodation_id=accommodation_id,
        statuses=[s.value for s in statuses] if statuses else None,
        search=search,
    )
    content = export_bookings_csv(db, rows)
    filename = export_filename(None, date_from, date_to)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# Image library
# ---------------------------------------------------------------------------


@router.get("/images", response_model=ListModel[AccommodationImagePublic])
async def list_images(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
) -> ListModel[AccommodationImagePublic]:
    rows = crud.accommodation_images_crud.find_by_popup(db, popup_id)
    return ListModel[AccommodationImagePublic](
        results=[AccommodationImagePublic.model_validate(row) for row in rows],
        paging=Paging(offset=0, limit=len(rows), total=len(rows)),
    )


@router.post(
    "/images",
    response_model=AccommodationImagePublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_image(
    image_in: AccommodationImageCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    current_user: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationImagePublic:
    """Register an already-uploaded file in the popup's photo bank.

    The upload itself goes through /upload like every other image; this only
    records the URL so it can be reused across room types.
    """
    tenant_id = _resolve_tenant_id(db, current_user, image_in.popup_id)
    row = crud.accommodation_images_crud.create_for_tenant(
        db, image_in, tenant_id, uploaded_by_user_id=current_user.id
    )
    return AccommodationImagePublic.model_validate(row)


@router.delete("/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_image(
    image_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> Response:
    row = db.get(AccommodationImages, image_id)
    if row is None:
        raise _not_found("Image")
    crud.accommodation_images_crud.delete(db, row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Units (static prefix, so declared before /{accommodation_id})
# ---------------------------------------------------------------------------


@router.patch("/units/{unit_id}", response_model=AccommodationUnitPublic)
async def update_unit(
    unit_id: uuid.UUID,
    unit_in: AccommodationUnitUpdate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationUnitPublic:
    unit = db.get(AccommodationUnits, unit_id)
    if unit is None:
        raise _not_found("Unit")
    updated = crud.accommodation_units_crud.update(db, unit, unit_in)
    return AccommodationUnitPublic.model_validate(updated)


@router.delete("/units/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_unit(
    unit_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> Response:
    """Remove a unit. Refused while a guest is (or will be) in it."""
    unit = db.get(AccommodationUnits, unit_id)
    if unit is None:
        raise _not_found("Unit")
    if crud.accommodation_units_crud.has_blocking_bookings(db, unit_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This unit has active bookings. Deactivate it instead so it "
                "stops being assigned to new stays."
            ),
        )
    crud.accommodation_units_crud.delete(db, unit)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Price rules (static prefix)
# ---------------------------------------------------------------------------


@router.patch("/price-rules/{rule_id}", response_model=AccommodationPriceRulePublic)
async def update_price_rule(
    rule_id: uuid.UUID,
    rule_in: AccommodationPriceRuleUpdate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPriceRulePublic:
    rule = db.get(AccommodationPriceRules, rule_id)
    if rule is None:
        raise _not_found("Price rule")

    start = rule_in.start_date or rule.start_date
    end = rule_in.end_date or rule.end_date
    if end < start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="end_date must be on or after start_date",
        )

    updated = crud.accommodation_price_rules_crud.update(db, rule, rule_in)
    return AccommodationPriceRulePublic.model_validate(updated)


@router.delete("/price-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_price_rule(
    rule_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> Response:
    rule = db.get(AccommodationPriceRules, rule_id)
    if rule is None:
        raise _not_found("Price rule")
    crud.accommodation_price_rules_crud.delete(db, rule)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Bulk (static prefix)
# ---------------------------------------------------------------------------


@router.post("/bulk-update", response_model=BulkResult)
async def bulk_update_accommodations(
    payload: AccommodationBulkUpdateRequest,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> BulkResult:
    """Apply one patch to many room types (by ids or by filter)."""
    targets = crud.accommodations_crud.resolve_targets(
        db, ids=payload.ids, bulk_filter=payload.filter
    )
    updated = crud.accommodations_crud.bulk_update(db, targets, payload.patch)
    return BulkResult(updated=updated)


@router.post("/bulk-price", response_model=BulkResult)
async def bulk_price_accommodations(
    payload: AccommodationBulkPrice,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> BulkResult:
    """Set or shift prices across many room types.

    With a date range this writes one date-range rule per room type instead
    of touching the base price, which is how seasons are expressed.
    """
    targets = crud.accommodations_crud.resolve_targets(
        db, ids=payload.ids, bulk_filter=payload.filter
    )
    updated = crud.accommodations_crud.bulk_price(db, targets, payload)
    return BulkResult(updated=updated)


# ---------------------------------------------------------------------------
# Accommodations (room types)
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[AccommodationPublic])
async def list_accommodations(
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
    popup_id: uuid.UUID,
    property_id: uuid.UUID | None = None,
    search: str | None = None,
) -> ListModel[AccommodationPublic]:
    rows = crud.accommodations_crud.find_by_popup(
        db,
        popup_id,
        property_ids=[property_id] if property_id else None,
        search=search,
    )
    return ListModel[AccommodationPublic](
        results=[_to_public(db, row) for row in rows],
        paging=Paging(offset=0, limit=len(rows), total=len(rows)),
    )


@router.post(
    "", response_model=AccommodationPublic, status_code=status.HTTP_201_CREATED
)
async def create_accommodation(
    accommodation_in: AccommodationCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    current_user: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPublic:
    """Create a room type (and its shadow product, and optionally its units)."""
    tenant_id = _resolve_tenant_id(db, current_user, accommodation_in.popup_id)

    property_row = _get_property(db, accommodation_in.property_id)
    if property_row.popup_id != accommodation_in.popup_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The property belongs to a different gathering",
        )

    row = crud.accommodations_crud.create_for_tenant(db, accommodation_in, tenant_id)
    return _to_public(db, row)


@router.get("/{accommodation_id}", response_model=AccommodationPublic)
async def get_accommodation(
    accommodation_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
) -> AccommodationPublic:
    return _to_public(db, _get_accommodation(db, accommodation_id))


@router.patch("/{accommodation_id}", response_model=AccommodationPublic)
async def update_accommodation(
    accommodation_id: uuid.UUID,
    accommodation_in: AccommodationUpdate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPublic:
    row = _get_accommodation(db, accommodation_id)

    if accommodation_in.property_id is not None:
        property_row = _get_property(db, accommodation_in.property_id)
        if property_row.popup_id != row.popup_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The property belongs to a different gathering",
            )

    start = accommodation_in.bookable_from or row.bookable_from
    end = accommodation_in.bookable_to or row.bookable_to
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="bookable_to must be after bookable_from",
        )

    updated = crud.accommodations_crud.update(db, row, accommodation_in)
    return _to_public(db, updated)


@router.delete("/{accommodation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_accommodation(
    accommodation_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> Response:
    """Retire a room type (soft delete).

    Existing bookings keep working and keep showing on the calendar; the room
    type simply stops being sellable (C15).
    """
    row = _get_accommodation(db, accommodation_id)
    crud.accommodations_crud.soft_delete(db, row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{accommodation_id}/duplicate",
    response_model=AccommodationPublic,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_accommodation(
    accommodation_id: uuid.UUID,
    payload: AccommodationDuplicate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPublic:
    """Clone a room type: definition, units, rules and photos, no bookings."""
    source = _get_accommodation(db, accommodation_id)
    copy = crud.accommodations_crud.duplicate(db, source, payload)
    return _to_public(db, copy)


@router.post(
    "/{accommodation_id}/units/bulk",
    response_model=list[AccommodationUnitPublic],
    status_code=status.HTTP_201_CREATED,
)
async def bulk_create_units(
    accommodation_id: uuid.UUID,
    payload: AccommodationUnitBulkCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> list[AccommodationUnitPublic]:
    """Add units from explicit labels or ``prefix`` + ``count``.

    Labels that already exist are skipped, so re-running the same call is
    safe.
    """
    accommodation = _get_accommodation(db, accommodation_id)
    units = crud.accommodation_units_crud.bulk_create(db, accommodation, payload)
    return [AccommodationUnitPublic.model_validate(unit) for unit in units]


@router.get(
    "/{accommodation_id}/price-rules",
    response_model=list[AccommodationPriceRulePublic],
)
async def list_price_rules(
    accommodation_id: uuid.UUID,
    db: AdminOrApiKeySession_AccommodationsRead,
    _: AdminOrApiKey_AccommodationsRead,
) -> list[AccommodationPriceRulePublic]:
    accommodation = _get_accommodation(db, accommodation_id)
    grouped = crud.accommodation_price_rules_crud.find_for_accommodations(
        db, [accommodation.id]
    )
    return [
        AccommodationPriceRulePublic.model_validate(rule)
        for rule in grouped.get(accommodation.id, [])
    ]


@router.post(
    "/{accommodation_id}/price-rules",
    response_model=AccommodationPriceRulePublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_price_rule(
    accommodation_id: uuid.UUID,
    rule_in: AccommodationPriceRuleCreate,
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> AccommodationPriceRulePublic:
    accommodation = _get_accommodation(db, accommodation_id)
    rule = crud.accommodation_price_rules_crud.create_for_accommodation(
        db, accommodation, rule_in
    )
    return AccommodationPriceRulePublic.model_validate(rule)


@router.put(
    "/{accommodation_id}/images",
    response_model=list[AccommodationImagePublic],
)
async def set_accommodation_images(
    accommodation_id: uuid.UUID,
    image_ids: list[uuid.UUID],
    db: AdminOrApiKeySession_AccommodationsWrite,
    _: AdminOrApiKey_AccommodationsWrite,
) -> list[AccommodationImagePublic]:
    """Replace the photo list of a room type, in the given order.

    Position 0 becomes the cover on the shadow product, which is what the
    checkout card shows.
    """
    accommodation = _get_accommodation(db, accommodation_id)
    updated = crud.accommodations_crud.update(
        db, accommodation, AccommodationUpdate(image_ids=image_ids)
    )
    return [
        AccommodationImagePublic.model_validate(image)
        for image in crud.accommodations_crud.images_for(db, updated.id)
    ]
