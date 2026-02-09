import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.product import crud
from app.api.product.schemas import (
    ProductCategory,
    ProductCreate,
    ProductPublic,
    ProductUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentUser, CurrentWriter, TenantSession
from app.utils.utils import slugify

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=ListModel[ProductPublic])
async def list_products(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: ProductCategory | None = None,
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
        )
    else:
        products, total = crud.products_crud.find(db, skip=skip, limit=limit)

    return ListModel[ProductPublic](
        results=[ProductPublic.model_validate(p) for p in products],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{product_id}", response_model=ProductPublic)
async def get_product(
    product_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
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
    """Delete a product."""

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    crud.products_crud.delete(db, product)
