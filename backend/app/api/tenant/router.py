import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.shared.enums import CredentialType, LandingMode, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.tenant import crud
from app.api.tenant.credential_schemas import CredentialInfo, TenantCredentialResponse
from app.api.tenant.schemas import (
    TenantCreate,
    TenantPublic,
    TenantUpdate,
)
from app.core.config import settings
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentOperator,
    CurrentSuperadmin,
    SessionDep,
)
from app.core.redis import domain_cache
from app.core.tenant_db import get_tenant_credential, revoke_tenant_credentials

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("/public/by-domain/{domain}", response_model=TenantPublic)
async def get_tenant_by_domain(
    domain: str,
    db: SessionDep,
) -> TenantPublic:
    """Resolve an active tenant by host — custom domain or platform subdomain.

    Resolution order (see TenantsCRUD.resolve_by_host):
    1. custom_domain field (active, not deleted)
    2. slug extracted from *.{PORTAL_DOMAIN} subdomain (not deleted)

    Returns the same HTTP 404 for both unknown and inactive hosts to
    avoid leaking which domains are registered (spec NFR2).
    No authentication required — used by portal middleware on every request.
    """
    # Cache-first: hit returns JSON or the "null" sentinel (cached 404)
    cached = domain_cache.get(domain)
    if cached is not None:
        if cached == "null":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            )
        return TenantPublic.model_validate_json(cached)

    # DB lookup — resolves custom domains AND *.PORTAL_DOMAIN subdomains
    tenant = crud.resolve_by_host(db, domain, settings.PORTAL_DOMAIN)
    if tenant is None:
        domain_cache.set(domain, "null")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    result = TenantPublic.model_validate(tenant)

    # Populate active_popup_slug for checkout-mode tenants (OI-2, R-T5, ADR — OI-2)
    # Local import avoids circular: tenant.router -> checkout.crud -> checkout.__init__ -> checkout.router -> payment.crud
    if tenant.landing_mode == LandingMode.checkout:
        from app.api.checkout.crud import (
            resolve_active_direct_popup_slug,  # noqa: PLC0415
        )

        result.active_popup_slug = resolve_active_direct_popup_slug(db, tenant.id)

    domain_cache.set(domain, result.model_dump_json())
    return result


@router.get("/public/{slug}", response_model=TenantPublic)
async def get_tenant_by_slug(
    slug: str,
    db: SessionDep,
) -> TenantPublic:
    tenant = crud.get_by_slug(db, slug)

    if tenant is None or tenant.deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    return TenantPublic.model_validate(tenant)


@router.get("", response_model=ListModel[TenantPublic])
async def list_tenants(
    db: SessionDep,
    _: CurrentSuperadmin,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[TenantPublic]:
    tenants, total = crud.find(
        db, skip=skip, limit=limit, search=search, search_fields=["name"]
    )

    return ListModel[TenantPublic](
        results=[TenantPublic.model_validate(t) for t in tenants],
        paging=Paging(
            offset=skip,
            limit=limit,
            total=total,
        ),
    )


@router.get("/{tenant_id}", response_model=TenantPublic)
async def get_tenant(
    tenant_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentOperator,
) -> TenantPublic:
    # Non-superadmins can only view their own tenant
    if current_user.role != UserRole.SUPERADMIN and current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot access other tenants",
        )

    tenant = crud.get(db, tenant_id)

    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    return TenantPublic.model_validate(tenant)


@router.post("", response_model=TenantPublic, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    tenant_in: TenantCreate,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> TenantPublic:
    existing = crud.get_by_slug(db, tenant_in.slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A tenant with this slug already exists",
        )

    tenant = crud.create(db, tenant_in)
    return TenantPublic.model_validate(tenant)


@router.patch("/{tenant_id}", response_model=TenantPublic)
async def update_tenant(
    tenant_id: uuid.UUID,
    tenant_in: TenantUpdate,
    db: SessionDep,
    current_user: CurrentAdmin,
) -> TenantPublic:
    # 1. Ownership check — admins can only update their own tenant
    if current_user.role == UserRole.ADMIN and current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot update other tenants",
        )

    # 2. Tenant exists check
    tenant = crud.get(db, tenant_id)
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    # 3. ADMIN cannot set custom_domain_active (only SUPERADMIN may)
    if (
        current_user.role == UserRole.ADMIN
        and tenant_in.custom_domain_active is not None
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin can modify custom_domain_active",
        )

    # 3b. ADMIN cannot set landing_mode (only SUPERADMIN may — ADR-4)
    if current_user.role == UserRole.ADMIN and tenant_in.landing_mode is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin can modify landing_mode",
        )

    # 4. ADMIN cannot change custom_domain while it is active
    if (
        current_user.role == UserRole.ADMIN
        and tenant_in.custom_domain is not None
        and tenant_in.custom_domain != tenant.custom_domain
        and tenant.custom_domain_active
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot change custom domain while it is active. Deactivate first.",
        )

    # 6. Custom domain uniqueness check (don't reveal owner)
    if (
        tenant_in.custom_domain is not None
        and tenant_in.custom_domain != tenant.custom_domain
    ):
        existing_domain = crud.get_by_field(
            db, "custom_domain", tenant_in.custom_domain
        )
        if existing_domain and existing_domain.id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This domain is already in use",
            )

    # 7. Merged-state validation for landing_mode=checkout (ADR-1, R-T2, Scenario T-2, T-3)
    # The schema-level validator catches obvious bad payloads; this catches the
    # cross-field case where the payload only has landing_mode but the current DB
    # row has custom_domain_active=False or custom_domain=None.
    if tenant_in.landing_mode == LandingMode.checkout:
        effective_active = (
            tenant_in.custom_domain_active
            if tenant_in.custom_domain_active is not None
            else tenant.custom_domain_active
        )
        effective_domain = (
            tenant_in.custom_domain
            if tenant_in.custom_domain is not None
            else tenant.custom_domain
        )
        if not effective_active or not effective_domain:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "landing_mode=checkout requires custom_domain_active=true and a "
                    "non-null custom_domain. Ensure the custom domain is configured "
                    "and active before switching to checkout mode."
                ),
            )

    # 8. Snapshot old domain and fields for cache invalidation after update
    old_domain = tenant.custom_domain
    old_landing_mode = tenant.landing_mode
    old_custom_domain_active = tenant.custom_domain_active

    # 9. Perform update (IntegrityError → unique constraint race condition)
    try:
        updated = crud.update(db, tenant, tenant_in)
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This domain is already in use",
        )

    # 10. Invalidate domain cache for old and new domain values, and on field changes
    # that affect the cached TenantPublic payload (ADR-2).
    new_domain = updated.custom_domain
    new_landing_mode = updated.landing_mode
    new_custom_domain_active = updated.custom_domain_active

    domains_to_invalidate: set[str] = set()

    # Always invalidate old domain when domain changes
    if old_domain and new_domain != old_domain:
        domains_to_invalidate.add(old_domain)

    # Invalidate current domain when landing_mode changes (R-T4)
    if new_landing_mode != old_landing_mode and new_domain:
        domains_to_invalidate.add(new_domain)

    # Invalidate current domain when custom_domain_active flips (ADR-2 latent gap fix)
    if new_custom_domain_active != old_custom_domain_active and new_domain:
        domains_to_invalidate.add(new_domain)

    # Also invalidate new domain when domain changes (existing behavior)
    if new_domain and new_domain != old_domain:
        domains_to_invalidate.add(new_domain)

    for d in domains_to_invalidate:
        domain_cache.invalidate(d)

    return TenantPublic.model_validate(updated)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: uuid.UUID,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> None:
    tenant = crud.get(db, tenant_id)

    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    crud.soft_delete(db, tenant)


@router.get(
    "/{tenant_id}/credentials",
    response_model=TenantCredentialResponse,
)
async def get_credentials(
    tenant_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentAdmin,
) -> TenantCredentialResponse:
    # Admins are scoped to their own tenant; superadmins can read any tenant.
    if current_user.role == UserRole.ADMIN and current_user.tenant_id != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view credentials for your own organization",
        )

    # Superadmins see CRUD and read-only credentials; admins only read-only.
    allowed_types = (
        list(CredentialType)
        if current_user.role == UserRole.SUPERADMIN
        else [CredentialType.READONLY]
    )

    credential_infos: list[CredentialInfo] = []

    for cred_type in allowed_types:
        result = get_tenant_credential(db, tenant_id, cred_type)
        if result:
            username, password = result
            credential_infos.append(
                CredentialInfo(
                    credential_type=cred_type,
                    db_username=username,
                    db_password=password,
                )
            )

    if not credential_infos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant has no credentials configured",
        )

    return TenantCredentialResponse(
        credentials=credential_infos,
        db_host=settings.POSTGRES_SERVER,
        db_port=settings.POSTGRES_PORT,
        db_name=settings.POSTGRES_DB,
    )


@router.delete(
    "/{tenant_id}/credentials",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_credentials(
    tenant_id: uuid.UUID,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> None:
    revoked = revoke_tenant_credentials(db, tenant_id)

    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant has no credentials to revoke",
        )
