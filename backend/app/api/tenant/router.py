import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.shared.enums import CredentialType, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.tenant import crud
from app.api.tenant.credential_schemas import CredentialInfo, TenantCredentialResponse
from app.api.tenant.schemas import TenantCreate, TenantPublic, TenantUpdate
from app.core.config import settings
from app.core.dependencies.users import CurrentAdmin, CurrentSuperadmin, SessionDep
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
    current_user: CurrentAdmin,
) -> TenantPublic:
    # Admins can only view their own tenant
    if current_user.role == UserRole.ADMIN and current_user.tenant_id != tenant_id:
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

    # 4. ADMIN cannot change custom_domain while it is active
    if (
        current_user.role == UserRole.ADMIN
        and tenant_in.custom_domain is not None
        and tenant.custom_domain_active
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot change custom domain while it is active. Deactivate first.",
        )

    # 5. Slug uniqueness check
    if tenant_in.slug and tenant_in.slug != tenant.slug:
        existing = crud.get_by_slug(db, tenant_in.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A tenant with this slug already exists",
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

    # 7. Snapshot old domain for cache invalidation after update
    old_domain = tenant.custom_domain

    # 8. Perform update (IntegrityError → unique constraint race condition)
    try:
        updated = crud.update(db, tenant, tenant_in)
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This domain is already in use",
        )

    # 9. Invalidate domain cache for old and new domain values
    new_domain = updated.custom_domain
    if old_domain:
        domain_cache.invalidate(old_domain)
    if new_domain and new_domain != old_domain:
        domain_cache.invalidate(new_domain)

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
    _: CurrentSuperadmin,
) -> TenantCredentialResponse:
    credential_infos: list[CredentialInfo] = []

    for cred_type in CredentialType:
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
