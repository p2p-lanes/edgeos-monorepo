import uuid
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, status

from app.api.product import crud
from app.api.product.schemas import (
    ProductCategory,
    ProductCreate,
    ProductPublic,
    ProductUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import CurrentUser, TenantSession
from app.utils.utils import slugify

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic

router = APIRouter(prefix="/products", tags=["products"])


def _check_write_permission(current_user: "UserPublic") -> None:
    """Check if user has write permission."""
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role does not have write access",
        )


@router.get("", response_model=ListModel[ProductPublic])
async def list_products(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    is_active: bool | None = None,
    category: ProductCategory | None = None,
    skip: int = 0,
    limit: int = 100,
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
    current_user: CurrentUser,
) -> ProductPublic:
    """Create a new product."""
    _check_write_permission(current_user)

    # Auto-generate slug from name if not provided
    slug = product_in.slug if product_in.slug else slugify(product_in.name)

    # Check for existing product with same slug in popup
    existing = crud.products_crud.get_by_slug(db, slug, product_in.popup_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A product with this slug already exists in this popup",
        )

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
    current_user: CurrentUser,
) -> ProductPublic:
    """Update a product."""
    _check_write_permission(current_user)

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    # Check slug uniqueness if being updated
    if product_in.slug and product_in.slug != product.slug:
        existing = crud.products_crud.get_by_slug(db, product_in.slug, product.popup_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A product with this slug already exists in this popup",
            )

    updated = crud.products_crud.update(db, product, product_in)
    return ProductPublic.model_validate(updated)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(
    product_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentUser,
) -> None:
    """Delete a product."""
    _check_write_permission(current_user)

    product = crud.products_crud.get(db, product_id)

    if not product:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Product not found",
        )

    crud.products_crud.delete(db, product)
