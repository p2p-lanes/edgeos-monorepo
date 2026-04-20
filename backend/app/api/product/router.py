import uuid
from datetime import UTC
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, HTTPException, status
from loguru import logger
from sqlalchemy.exc import IntegrityError

from app.api.product import crud
from app.api.product.schemas import (
    ProductBatch,
    ProductBatchResult,
    ProductCreate,
    ProductPublic,
    ProductPublicWithTier,
    ProductUpdate,
    TierGroupCreate,
    TierGroupPublic,
    TierGroupUpdate,
    TierPhaseCreate,
    TierPhasePublic,
    TierPhaseUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.translation.service import (
    TRANSLATABLE_FIELDS,
    apply_translation_overlay,
    delete_translations_for_entity,
    get_translations_bulk,
)
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    CurrentSuperadmin,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)
from app.utils.utils import slugify

router = APIRouter(prefix="/products", tags=["products"])

# ---------------------------------------------------------------------------
# Tier group sub-router — mounted at /ticket-tier-groups
# ---------------------------------------------------------------------------

tier_router = APIRouter(prefix="/ticket-tier-groups", tags=["ticket-tier-groups"])


def _require_tier_progression(popup_id: uuid.UUID, db: Any) -> None:
    """Raise 404 if tier_progression_enabled is False for the popup."""
    from app.api.popup.models import Popups

    popup = db.get(Popups, popup_id)
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    if not popup.tier_progression_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tier progression is not enabled for this popup",
        )


def _require_tier_progression_for_group(group_id: uuid.UUID, db: Any) -> None:
    """Raise 404 if the popup that owns any product in this group has the flag off.

    For group-scoped endpoints where popup_id isn't provided directly, we read
    the flag from the popup of the first phase's product — or skip if no phases.
    """
    from sqlmodel import select

    from app.api.popup.models import Popups
    from app.api.product.models import Products, TicketTierGroup, TicketTierPhase

    group = db.get(TicketTierGroup, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tier group not found",
        )

    # Try to find a popup via the first phase product
    phase = db.exec(
        select(TicketTierPhase).where(TicketTierPhase.group_id == group_id).limit(1)
    ).first()
    if phase is None:
        # No phases yet; can't check flag from popup. Allow access.
        return

    product = db.get(Products, phase.product_id)
    if product is None:
        return

    popup = db.get(Popups, product.popup_id)
    if popup is None:
        return
    if not popup.tier_progression_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tier progression is not enabled for this popup",
        )


@tier_router.post(
    "", response_model=TierGroupPublic, status_code=status.HTTP_201_CREATED
)
async def create_tier_group(
    obj_in: TierGroupCreate,
    db: TenantSession,
    current_user: CurrentAdmin,
) -> TierGroupPublic:
    """Create a new ticket tier group (ADMIN only)."""
    from app.api.popup.models import Popups

    # popup_id is required to check the feature flag
    popup_id = (
        obj_in.popup_id if hasattr(obj_in, "popup_id") and obj_in.popup_id else None
    )
    if popup_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="popup_id is required",
        )

    _require_tier_progression(popup_id, db)

    # Derive tenant_id
    if current_user.role == UserRole.SUPERADMIN:
        popup = db.get(Popups, popup_id)
        if popup is None:
            raise HTTPException(status_code=404, detail="Popup not found")
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id  # type: ignore[assignment]

    group = crud.tier_groups_crud.create_for_tenant(db, obj_in, tenant_id)
    return _group_to_public(db, group)


@tier_router.get("", response_model=ListModel[TierGroupPublic])
async def list_tier_groups(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
) -> ListModel[TierGroupPublic]:
    """List tier groups. Optionally filter by popup_id."""
    if popup_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="popup_id query parameter is required",
        )
    _require_tier_progression(popup_id, db)
    groups = crud.tier_groups_crud.find_by_popup(db, popup_id)
    results = [_group_to_public(db, g) for g in groups]
    return ListModel[TierGroupPublic](
        results=results,
        paging=Paging(offset=0, limit=len(results), total=len(results)),
    )


@tier_router.get("/{group_id}", response_model=TierGroupPublic)
async def get_tier_group(
    group_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> TierGroupPublic:
    """Get a single tier group by ID."""
    group = crud.tier_groups_crud.get(db, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Tier group not found")
    return _group_to_public(db, group)


@tier_router.patch("/{group_id}", response_model=TierGroupPublic)
async def update_tier_group(
    group_id: uuid.UUID,
    obj_in: TierGroupUpdate,
    db: TenantSession,
    _: CurrentAdmin,
) -> TierGroupPublic:
    """Update a tier group (ADMIN only)."""
    group = crud.tier_groups_crud.get(db, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Tier group not found")
    group = crud.tier_groups_crud.update(db, group, obj_in)
    return _group_to_public(db, group)


@tier_router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tier_group(
    group_id: uuid.UUID,
    db: TenantSession,
    _: CurrentAdmin,
) -> None:
    """Delete a tier group (ADMIN only)."""
    group = crud.tier_groups_crud.get(db, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Tier group not found")
    crud.tier_groups_crud.delete(db, group)


# ---------------------------------------------------------------------------
# Phase sub-endpoints nested under tier groups
# ---------------------------------------------------------------------------


@tier_router.post(
    "/{group_id}/phases",
    response_model=dict,
    status_code=status.HTTP_201_CREATED,
)
async def create_tier_phase(
    group_id: uuid.UUID,
    obj_in: TierPhaseCreate,
    db: TenantSession,
    _: CurrentAdmin,
) -> dict:
    """Add a phase to a tier group (ADMIN only).

    Returns HTTP 422 when the product is already bound to another phase.
    `order` is derived server-side from `sale_starts_at` ASC NULLS LAST.
    """
    group = crud.tier_groups_crud.get(db, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Tier group not found")

    # Override group_id from path
    create_obj = TierPhaseCreate(
        group_id=group_id,
        product_id=obj_in.product_id,
        label=obj_in.label,
        sale_starts_at=obj_in.sale_starts_at,
        sale_ends_at=obj_in.sale_ends_at,
    )

    try:
        phase = crud.tier_phases_crud.create_for_group(db, create_obj)
    except IntegrityError as e:
        db.rollback()
        err = str(e.orig) if e.orig else str(e)
        if "uq_ticket_tier_phase_product_id" in err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="This product is already assigned to a tier phase",
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Integrity constraint violation: {err}",
        )

    return {
        "id": str(phase.id),
        "group_id": str(phase.group_id),
        "product_id": str(phase.product_id),
        "order": phase.order,
        "label": phase.label,
        "sale_starts_at": phase.sale_starts_at.isoformat()
        if phase.sale_starts_at
        else None,
        "sale_ends_at": phase.sale_ends_at.isoformat() if phase.sale_ends_at else None,
    }


@tier_router.patch("/{group_id}/phases/{phase_id}", response_model=dict)
async def update_tier_phase(
    group_id: uuid.UUID,
    phase_id: uuid.UUID,
    obj_in: TierPhaseUpdate,
    db: TenantSession,
    _: CurrentAdmin,
) -> dict:
    """Update a tier phase (ADMIN only)."""
    phase = crud.tier_phases_crud.get(db, phase_id)
    if phase is None or phase.group_id != group_id:
        raise HTTPException(status_code=404, detail="Phase not found")
    try:
        phase = crud.tier_phases_crud.update(db, phase, obj_in)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Integrity constraint violation while updating phase",
        )
    return {
        "id": str(phase.id),
        "group_id": str(phase.group_id),
        "product_id": str(phase.product_id),
        "order": phase.order,
        "label": phase.label,
        "sale_starts_at": phase.sale_starts_at.isoformat()
        if phase.sale_starts_at
        else None,
        "sale_ends_at": phase.sale_ends_at.isoformat() if phase.sale_ends_at else None,
    }


@tier_router.delete(
    "/{group_id}/phases/{phase_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_tier_phase(
    group_id: uuid.UUID,
    phase_id: uuid.UUID,
    db: TenantSession,
    _: CurrentAdmin,
) -> None:
    """Remove a phase from a tier group (ADMIN only)."""
    phase = crud.tier_phases_crud.get(db, phase_id)
    if phase is None or phase.group_id != group_id:
        raise HTTPException(status_code=404, detail="Phase not found")
    crud.tier_phases_crud.delete(db, phase)


# ---------------------------------------------------------------------------
# Helper: build TierGroupPublic dict from ORM model
# ---------------------------------------------------------------------------


def _group_to_public(db: Any, group: Any) -> TierGroupPublic:
    """Construct TierGroupPublic with embedded phases.

    Phases carry placeholder derived fields; real derivation happens at product
    fetch time via enrich_product_with_tier.
    """
    from datetime import datetime

    from sqlmodel import select

    from app.api.product.models import TicketTierPhase
    from app.api.product.tier_progression import derive_phase_states

    all_phases = list(
        db.exec(
            select(TicketTierPhase)
            .where(TicketTierPhase.group_id == group.id)
            .order_by(TicketTierPhase.order)
        ).all()
    )

    sold_counts: dict = {
        p.id: crud.tier_phases_crud.get_sold_count(db, p.id) for p in all_phases
    }
    # Resolve max_quantity per phase via the linked product
    product_ids_for_phases = [p.product_id for p in all_phases]
    products_map = crud.products_crud.get_by_ids(db, product_ids_for_phases)
    max_quantities: dict = {
        p.id: products_map[p.product_id].max_quantity
        if p.product_id in products_map
        else None
        for p in all_phases
    }
    now = datetime.now(UTC)
    phase_results = derive_phase_states(
        group,
        all_phases,
        now=now,
        sold_counts=sold_counts,
        max_quantities=max_quantities,
    )
    result_by_id = {r.id: r for r in phase_results}

    phases_public = []
    for ph in all_phases:
        r = result_by_id.get(ph.id)
        if r is None:
            continue
        phases_public.append(
            TierPhasePublic(
                id=ph.id,
                group_id=ph.group_id,
                product_id=ph.product_id,
                order=ph.order,
                label=ph.label,
                sale_starts_at=ph.sale_starts_at,
                sale_ends_at=ph.sale_ends_at,
                sales_state=r.sales_state,  # type: ignore[arg-type]
                is_purchasable=r.is_purchasable,
                remaining=r.remaining,
            )
        )

    return TierGroupPublic(
        id=group.id,
        tenant_id=group.tenant_id,
        name=group.name,
        shared_stock_cap=group.shared_stock_cap,
        shared_stock_remaining=group.shared_stock_remaining,
        phases=phases_public,
    )


@router.get("/categories", response_model=list[str])
async def list_product_categories(
    db: SessionDep,
    popup_id: uuid.UUID,
) -> list[str]:
    """Return distinct active product categories for a popup. No auth required."""
    from sqlmodel import distinct, select

    from app.api.product.models import Products

    statement = (
        select(distinct(Products.category))
        .where(
            Products.popup_id == popup_id,
            Products.is_active == True,  # noqa: E712
            Products.deleted_at.is_(None),  # type: ignore[attr-defined]
        )
        .order_by(Products.category)
    )
    results = list(db.exec(statement).all())
    return results


def _load_tier_progression_flags(db: Any, products: list[Any]) -> dict[uuid.UUID, bool]:
    """Bulk-fetch popups referenced by a product list and return their flag state.

    Used by list endpoints to decide, per product, whether to run the tier
    enrichment pass — avoids an N+1 popup lookup.
    """
    from sqlmodel import select as _select

    from app.api.popup.models import Popups

    popup_ids = {p.popup_id for p in products if getattr(p, "popup_id", None)}
    if not popup_ids:
        return {}
    stmt = _select(Popups.id, Popups.tier_progression_enabled).where(
        Popups.id.in_(popup_ids)  # type: ignore[attr-defined]
    )
    return {row.id: bool(row.tier_progression_enabled) for row in db.exec(stmt).all()}


def _enrich_product_list(db: Any, products: list[Any]) -> list[ProductPublicWithTier]:
    """Project a product list to ProductPublicWithTier, respecting popup flags.

    Products whose popup has tier_progression_enabled=False (or no phase)
    return with tier_group=None and phase=None — additive and backward-compat.
    """
    flag_by_popup = _load_tier_progression_flags(db, products)
    out: list[ProductPublicWithTier] = []
    for p in products:
        base = ProductPublic.model_validate(p)
        if flag_by_popup.get(p.popup_id):
            tier_data = crud.enrich_product_with_tier(db, p)
        else:
            tier_data = {"tier_group": None, "phase": None}
        out.append(ProductPublicWithTier(**base.model_dump(), **tier_data))
    return out


@router.get("", response_model=ListModel[ProductPublicWithTier])
async def list_products(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: Literal["asc", "desc"] = "desc",
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ProductPublicWithTier]:
    """List all products with optional filters.

    Response carries enriched tier_group/phase fields for products whose popup
    has tier_progression_enabled=True; null otherwise (BC-2 additive).
    """
    if popup_id:
        products, total = crud.products_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            is_active=is_active,
            category=category,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    else:
        products, total = crud.products_crud.find(
            db,
            skip=skip,
            limit=limit,
            search=search,
            search_fields=["name"],
            sort_by=sort_by,
            sort_order=sort_order,
        )

    return ListModel[ProductPublicWithTier](
        results=_enrich_product_list(db, products),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/batch",
    response_model=list[ProductBatchResult],
    status_code=status.HTTP_207_MULTI_STATUS,
)
async def create_products_batch(
    batch: ProductBatch,
    db: TenantSession,
    _current_user: CurrentSuperadmin,
) -> list[ProductBatchResult]:
    """Batch-create products (superadmin only)."""
    from app.api.popup.crud import popups_crud
    from app.api.product.models import Products

    popup = popups_crud.get(db, batch.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    tenant_id = popup.tenant_id

    results: list[ProductBatchResult] = []
    for idx, item in enumerate(batch.products):
        try:
            with db.begin_nested():
                base_slug = item.slug if item.slug else slugify(item.name)
                slug = crud.products_crud.generate_unique_slug(
                    db, base_slug, batch.popup_id
                )

                product_data = item.model_dump()
                product_data["tenant_id"] = tenant_id
                product_data["popup_id"] = batch.popup_id
                product_data["slug"] = slug
                product = Products(**product_data)

                db.add(product)
                db.flush()

                results.append(
                    ProductBatchResult(
                        **ProductPublic.model_validate(product).model_dump(),
                        success=True,
                        err_msg=None,
                        row_number=idx + 1,
                    )
                )
        except Exception as e:
            logger.warning(f"Failed to create product row {idx + 1}: {e}")
            results.append(
                ProductBatchResult(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    popup_id=batch.popup_id,
                    name=item.name,
                    slug="",
                    price=item.price,
                    category=item.category,
                    is_active=item.is_active,
                    success=False,
                    err_msg=str(e),
                    row_number=idx + 1,
                )
            )

    db.commit()
    return results


@router.get("/{product_id}", response_model=ProductPublicWithTier)
async def get_product(
    product_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> ProductPublicWithTier:
    """Get a single product by ID.

    When the product's popup has tier_progression_enabled=True, the response
    includes enriched tier_group and phase fields (BC-2 additive).
    """
    from app.api.popup.models import Popups

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    base = ProductPublic.model_validate(product)
    popup = db.get(Popups, product.popup_id)
    if popup and popup.tier_progression_enabled:
        tier_data = crud.enrich_product_with_tier(db, product)
    else:
        tier_data = {"tier_group": None, "phase": None}

    return ProductPublicWithTier(**base.model_dump(), **tier_data)


@router.post("", response_model=ProductPublic, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_in: ProductCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> ProductPublic:
    """Create a new product."""

    # Auto-generate unique slug from name if not provided
    base_slug = product_in.slug if product_in.slug else slugify(product_in.name)
    slug = crud.products_crud.generate_unique_slug(db, base_slug, product_in.popup_id)

    # Set tenant_id based on user role
    if current_user.role == UserRole.SUPERADMIN:
        # For superadmin, we need to get tenant_id from the popup
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, product_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Create internal schema with tenant_id and generated slug
    from app.api.product.models import Products

    product_data = product_in.model_dump()
    product_data["tenant_id"] = tenant_id
    product_data["slug"] = slug
    product = Products(**product_data)

    db.add(product)
    db.commit()
    db.refresh(product)

    return ProductPublic.model_validate(product)


@router.patch("/{product_id}", response_model=ProductPublic)
async def update_product(
    product_id: uuid.UUID,
    product_in: ProductUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> ProductPublic:
    """Update a product."""

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    # Auto-regenerate slug when name changes and no explicit slug is provided
    if product_in.name and not product_in.slug and product_in.name != product.name:
        new_base_slug = slugify(product_in.name)
        product_in.slug = crud.products_crud.generate_unique_slug(
            db, new_base_slug, product.popup_id
        )
    elif product_in.slug and product_in.slug != product.slug:
        product_in.slug = crud.products_crud.generate_unique_slug(
            db, product_in.slug, product.popup_id
        )

    updated = crud.products_crud.update(db, product, product_in)
    return ProductPublic.model_validate(updated)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    """Delete a product.

    Hard deletes when the product has no historical ties. If the product is
    referenced by attendee_products, payment_products, or a tier phase, a
    soft-delete is performed instead (`deleted_at` is set). The partial unique
    index releases the slug so it can be reused by a new product.
    """
    from sqlmodel import func, select

    from app.api.attendee.models import AttendeeProducts
    from app.api.payment.models import PaymentProducts
    from app.api.product.models import TicketTierPhase

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    has_history = db.exec(
        select(func.count())
        .select_from(AttendeeProducts)
        .where(AttendeeProducts.product_id == product.id)
    ).one() > 0 or db.exec(
        select(func.count())
        .select_from(PaymentProducts)
        .where(PaymentProducts.product_id == product.id)
    ).one() > 0 or db.exec(
        select(func.count())
        .select_from(TicketTierPhase)
        .where(TicketTierPhase.product_id == product.id)
    ).one() > 0

    if has_history:
        crud.products_crud.soft_delete(db, product)
    else:
        delete_translations_for_entity(db, "product", product.id)
        crud.products_crud.delete(db, product)


@router.get("/portal/products", response_model=ListModel[ProductPublicWithTier])
async def list_portal_products(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> ListModel[ProductPublicWithTier]:
    """List products visible to the current human (Portal).

    Response carries enriched tier_group/phase fields for products whose popup
    has tier_progression_enabled=True; null otherwise (BC-2 additive).
    """
    if popup_id:
        products, total = crud.products_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            is_active=is_active,
            category=category,
        )
    else:
        products, total = crud.products_crud.find(
            db,
            skip=skip,
            limit=limit,
        )

    lang = None
    if accept_language and accept_language != "en":
        lang = accept_language.split(",")[0].split("-")[0].strip()

    flag_by_popup = _load_tier_progression_flags(db, products)
    translations_map: dict[uuid.UUID, Any] = {}
    if lang:
        translations_map = get_translations_bulk(
            db, "product", [p.id for p in products], lang
        )

    results: list[ProductPublicWithTier] = []
    for p in products:
        base_data = ProductPublic.model_validate(p).model_dump()
        if lang:
            base_data = apply_translation_overlay(
                base_data,
                translations_map.get(p.id),
                TRANSLATABLE_FIELDS["product"],
            )
        if flag_by_popup.get(p.popup_id):
            tier_data = crud.enrich_product_with_tier(db, p)
        else:
            tier_data = {"tier_group": None, "phase": None}
        results.append(ProductPublicWithTier(**base_data, **tier_data))

    return ListModel[ProductPublicWithTier](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )
