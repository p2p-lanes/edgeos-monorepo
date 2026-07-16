import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, HTTPException, status
from loguru import logger

from app.api.product import crud
from app.api.product.schemas import (
    ProductBatch,
    ProductBatchResult,
    ProductCreate,
    ProductPublic,
    ProductSoldOutUpdate,
    ProductUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.translation.service import (
    TRANSLATABLE_FIELDS,
    apply_translation_overlay,
    delete_translations_for_entity,
    get_translations_bulk,
    parse_accept_language,
)
from app.core.dependencies.users import (
    AdminOrApiKey_ProductsRead,
    AdminOrApiKey_ProductsWrite,
    AdminOrApiKeySession_ProductsRead,
    AdminOrApiKeySession_ProductsWrite,
    CurrentHuman,
    CurrentSuperadmin,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)
from app.services.image_ingestion import ImageIngestionService
from app.utils.utils import slugify

router = APIRouter(prefix="/products", tags=["products"])


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


@router.get("", response_model=ListModel[ProductPublic])
async def list_products(
    db: AdminOrApiKeySession_ProductsRead,
    _: AdminOrApiKey_ProductsRead,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: Literal["asc", "desc"] = "desc",
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[ProductPublic]:
    """List all products with optional filters."""
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

    return ListModel[ProductPublic](
        results=[ProductPublic.model_validate(p) for p in products],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post(
    "/batch",
    response_model=list[ProductBatchResult],
    status_code=status.HTTP_207_MULTI_STATUS,
    deprecated=True,
)
async def create_products_batch(
    batch: ProductBatch,
    db: TenantSession,
    _current_user: CurrentSuperadmin,
) -> list[ProductBatchResult]:
    """Batch-create products (superadmin only).

    DEPRECATED: this endpoint was a one-off CSV import experiment. The
    backoffice no longer exposes it. Slated for removal.
    """
    from app.api.popup.crud import popups_crud
    from app.api.product.models import Products

    popup = popups_crud.get(db, batch.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    tenant_id = popup.tenant_id

    _svc = ImageIngestionService()
    results: list[ProductBatchResult] = []
    for idx, item in enumerate(batch.products):
        try:
            with db.begin_nested():
                base_slug = item.slug if item.slug else slugify(item.name)
                slug = crud.products_crud.generate_unique_slug(
                    db, base_slug, batch.popup_id
                )

                product_data = crud.sale_dates_to_persistence(item.model_dump())
                product_data["tenant_id"] = tenant_id
                product_data["popup_id"] = batch.popup_id
                product_data["slug"] = slug

                # CDN image ingestion: rewrite external URLs to CDN before commit.
                # Fail-open: any per-URL failure keeps the original URL.
                product_data["image_url"] = await _svc.ingest_url(
                    product_data.get("image_url"), tenant_id
                )
                product_data["images"] = await _svc.ingest_urls(
                    product_data.get("images") or [], tenant_id
                )

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


@router.get("/{product_id}", response_model=ProductPublic)
async def get_product(
    product_id: uuid.UUID,
    db: AdminOrApiKeySession_ProductsRead,
    _: AdminOrApiKey_ProductsRead,
) -> ProductPublic:
    """Get a single product by ID."""
    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    return ProductPublic.model_validate(product)


@router.post("", response_model=ProductPublic, status_code=status.HTTP_201_CREATED)
async def create_product(
    product_in: ProductCreate,
    db: AdminOrApiKeySession_ProductsWrite,
    current_user: AdminOrApiKey_ProductsWrite,
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

    # Singleton guard: reject if category=patreon and another active one exists
    if product_in.category == "patreon":
        crud.products_crud._assert_no_active_patreon(db, product_in.popup_id)

    # Create internal schema with tenant_id and generated slug
    from app.api.product.models import Products

    product_data = product_in.model_dump()
    product_data["tenant_id"] = tenant_id
    product_data["slug"] = slug

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: any per-URL failure keeps the original URL.
    _svc = ImageIngestionService()
    product_data["image_url"] = await _svc.ingest_url(
        product_data.get("image_url"), tenant_id
    )
    product_data["images"] = await _svc.ingest_urls(
        product_data.get("images") or [], tenant_id
    )

    product = Products(**product_data)

    db.add(product)
    db.commit()
    db.refresh(product)

    return ProductPublic.model_validate(product)


@router.patch("/{product_id}", response_model=ProductPublic)
async def update_product(
    product_id: uuid.UUID,
    product_in: ProductUpdate,
    db: AdminOrApiKeySession_ProductsWrite,
    _current_user: AdminOrApiKey_ProductsWrite,
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

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: any per-URL failure keeps the original URL.
    _svc = ImageIngestionService()
    if product_in.image_url is not None:
        product_in.image_url = await _svc.ingest_url(
            product_in.image_url, product.tenant_id
        )
    if product_in.images is not None:
        product_in.images = await _svc.ingest_urls(product_in.images, product.tenant_id)

    updated = crud.products_crud.update(db, product, product_in)
    return ProductPublic.model_validate(updated)


@router.post("/{product_id}/sold-out", response_model=ProductPublic)
async def set_product_sold_out(
    product_id: uuid.UUID,
    payload: ProductSoldOutUpdate,
    db: AdminOrApiKeySession_ProductsWrite,
    _current_user: AdminOrApiKey_ProductsWrite,
) -> ProductPublic:
    """Mark a product as sold out, or put it back on sale.

    Sets the manual `sold_out_override` flag only. The stock counter is
    never modified, so inventory accounting stays truthful. While the flag
    is on, the product reports state `sold_out` and checkout rejects new
    purchases regardless of remaining stock.
    """
    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    updated = crud.products_crud.set_sold_out(db, product, payload.sold_out)
    return ProductPublic.model_validate(updated)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: uuid.UUID,
    db: AdminOrApiKeySession_ProductsWrite,
    _current_user: AdminOrApiKey_ProductsWrite,
) -> None:
    """Delete a product.

    Hard deletes when the product has no historical ties. If the product is
    referenced by attendee_products or payment_products, a soft-delete is
    performed instead (`deleted_at` is set). The partial unique index releases
    the slug so it can be reused by a new product.
    """
    from sqlmodel import func, select

    from app.api.attendee.models import AttendeeProducts
    from app.api.payment.models import PaymentProducts

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    has_history = (
        db.exec(
            select(func.count())
            .select_from(AttendeeProducts)
            .where(AttendeeProducts.product_id == product.id)
        ).one()
        > 0
        or db.exec(
            select(func.count())
            .select_from(PaymentProducts)
            .where(PaymentProducts.product_id == product.id)
        ).one()
        > 0
    )

    if has_history:
        crud.products_crud.soft_delete(db, product)
    else:
        delete_translations_for_entity(db, "product", product.id)
        crud.products_crud.delete(db, product)


@router.get("/portal/products", response_model=ListModel[ProductPublic])
async def list_portal_products(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> ListModel[ProductPublic]:
    """List products visible to the current human (Portal)."""
    if popup_id:
        # Ended popups keep their products visible here: the portal recap
        # views still need them, and purchasing is blocked at the payment,
        # cart, and application layers.
        products, total = crud.products_crud.find_by_popup(
            db,
            popup_id=popup_id,
            skip=skip,
            limit=limit,
            is_active=is_active,
            category=category,
        )
    else:
        # Same read-only contract without popup_id: ended-popup products are
        # excluded so they cannot be enumerated through the unscoped listing.
        products, total = crud.products_crud.find_excluding_ended_popups(
            db,
            skip=skip,
            limit=limit,
            is_active=is_active,
            category=category,
        )

    lang = parse_accept_language(accept_language)

    translations_map: dict[uuid.UUID, Any] = {}
    if lang:
        translations_map = get_translations_bulk(
            db, "product", [p.id for p in products], lang
        )

    results: list[ProductPublic] = []
    for p in products:
        base_data = ProductPublic.model_validate(p).model_dump()
        if lang:
            base_data = apply_translation_overlay(
                base_data,
                translations_map.get(p.id),
                TRANSLATABLE_FIELDS["product"],
            )
        results.append(ProductPublic(**base_data))

    return ListModel[ProductPublic](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )
