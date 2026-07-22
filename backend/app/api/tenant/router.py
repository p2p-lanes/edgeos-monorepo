import uuid
from html import escape

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.shared.enums import CredentialType, LandingMode, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.tenant import crud
from app.api.tenant.credential_schemas import CredentialInfo, TenantCredentialResponse
from app.api.tenant.schemas import (
    TenantAnonymousPublic,
    TenantCreate,
    TenantPublic,
    TenantSmtpTestRequest,
    TenantSmtpTestResponse,
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
from app.services.image_ingestion import ImageIngestionService
from app.utils.encryption import encrypt

router = APIRouter(prefix="/tenants", tags=["tenants"])

# Machine-readable detail (and domain-cache sentinel) for suspended tenants.
# Kept equal to app.api.auth.crud.TRIAL_ENDED_DETAIL so every surface returns
# the same shape: 403 {"detail": "trial_ended"}.
TRIAL_ENDED_SENTINEL = "trial_ended"


def _smtp_password_configured_after_payload(
    current_encrypted: str | None,
    password_in_payload: bool,
    password_value: str | None,
) -> bool:
    if not password_in_payload:
        return bool(current_encrypted)
    if password_value is None:
        return False
    if password_value == "":
        return bool(current_encrypted)
    return True


def _validate_smtp_state(
    *,
    smtp_host: str | None,
    smtp_user: str | None,
    smtp_password_configured: bool,
    smtp_tls: bool | None,
    smtp_ssl: bool | None,
) -> None:
    if smtp_tls and smtp_ssl:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="smtp_tls and smtp_ssl cannot both be true",
        )

    if not smtp_host:
        if smtp_user or smtp_password_configured:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="smtp_host is required when SMTP credentials are configured",
            )
        return

    if bool(smtp_user) != smtp_password_configured:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="smtp_user and smtp_password must be configured together",
        )


@router.get("/public/by-domain/{domain}", response_model=TenantAnonymousPublic)
async def get_tenant_by_domain(
    domain: str,
    db: SessionDep,
) -> TenantAnonymousPublic:
    """Resolve an active tenant by host — custom domain or platform subdomain.

    Resolution order (see TenantsCRUD.resolve_by_host):
    1. custom_domain field (active, not deleted)
    2. slug extracted from *.{PORTAL_DOMAIN} subdomain (not deleted)

    Returns the same HTTP 404 for both unknown and inactive hosts to
    avoid leaking which domains are registered (spec NFR2).
    No authentication required — used by portal middleware on every request.
    """
    # Cache-first: hit returns JSON or a sentinel ("null" = cached 404,
    # "trial_ended" = cached suspension)
    cached = domain_cache.get(domain)
    if cached is not None:
        if cached == "null":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Not found"
            )
        if cached == TRIAL_ENDED_SENTINEL:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=TRIAL_ENDED_SENTINEL
            )
        return TenantAnonymousPublic.model_validate_json(cached)

    # DB lookup — resolves custom domains AND *.PORTAL_DOMAIN subdomains
    tenant = crud.resolve_by_host(db, domain, settings.PORTAL_DOMAIN)
    if tenant is None:
        domain_cache.set(domain, "null")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    # Suspended tenant (expired trial): the portal shows a "trial ended" screen.
    # Distinct from 404 so the frontend can tell "unknown host" from
    # "known but paused". Data and credentials remain intact.
    if tenant.suspended_at is not None:
        domain_cache.set(domain, TRIAL_ENDED_SENTINEL)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=TRIAL_ENDED_SENTINEL
        )

    result = TenantAnonymousPublic.model_validate(tenant)

    # Populate active_popup_slug for checkout-mode tenants (OI-2, R-T5, ADR — OI-2)
    # Local import avoids circular: tenant.router -> checkout.crud -> checkout.__init__ -> checkout.router -> payment.crud
    if tenant.landing_mode == LandingMode.checkout:
        from app.api.checkout.crud import (
            resolve_active_direct_popup_slug,  # noqa: PLC0415
        )

        result.active_popup_slug = resolve_active_direct_popup_slug(db, tenant.id)

    domain_cache.set(domain, result.model_dump_json())
    return result


@router.get("/public/{slug}", response_model=TenantAnonymousPublic)
async def get_tenant_by_slug(
    slug: str,
    db: SessionDep,
) -> TenantAnonymousPublic:
    tenant = crud.get_by_slug(db, slug)

    if tenant is None or tenant.deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    if tenant.suspended_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=TRIAL_ENDED_SENTINEL
        )

    return TenantAnonymousPublic.model_validate(tenant)


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

    _validate_smtp_state(
        smtp_host=tenant_in.smtp_host,
        smtp_user=tenant_in.smtp_user,
        smtp_password_configured=bool(tenant_in.smtp_password),
        smtp_tls=tenant_in.smtp_tls,
        smtp_ssl=tenant_in.smtp_ssl,
    )
    tenant = crud.create(db, tenant_in)

    # CDN image ingestion: must happen AFTER create because tenant.id is the storage
    # key (it is auto-generated and only available after the first commit).
    # Fail-open: any per-URL failure keeps the original URL; the save still succeeds.
    _svc = ImageIngestionService()
    tenant.image_url = await _svc.ingest_url(tenant_in.image_url, tenant.id)
    tenant.icon_url = await _svc.ingest_url(tenant_in.icon_url, tenant.id)
    tenant.logo_url = await _svc.ingest_url(tenant_in.logo_url, tenant.id)
    if tenant_in.smtp_password:
        tenant.smtp_password_encrypted = encrypt(tenant_in.smtp_password)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
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
    old_meta_tracking_enabled = tenant.meta_tracking_enabled
    old_meta_pixel_id = tenant.meta_pixel_id

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: any per-URL failure keeps the original URL.
    _svc = ImageIngestionService()
    if tenant_in.image_url is not None:
        tenant_in.image_url = await _svc.ingest_url(tenant_in.image_url, tenant.id)
    if tenant_in.icon_url is not None:
        tenant_in.icon_url = await _svc.ingest_url(tenant_in.icon_url, tenant.id)
    if tenant_in.logo_url is not None:
        tenant_in.logo_url = await _svc.ingest_url(tenant_in.logo_url, tenant.id)

    # 9. Perform update (IntegrityError → unique constraint race condition)
    try:
        if "meta_capi_access_token" in tenant_in.model_fields_set:
            token = tenant_in.meta_capi_access_token
            tenant.meta_capi_access_token_encrypted = encrypt(token) if token else None

        smtp_password_in_payload = "smtp_password" in tenant_in.model_fields_set
        smtp_password_configured = _smtp_password_configured_after_payload(
            tenant.smtp_password_encrypted,
            smtp_password_in_payload,
            tenant_in.smtp_password,
        )
        effective_smtp_host = (
            tenant_in.smtp_host
            if "smtp_host" in tenant_in.model_fields_set
            else tenant.smtp_host
        )
        effective_smtp_user = (
            tenant_in.smtp_user
            if "smtp_user" in tenant_in.model_fields_set
            else tenant.smtp_user
        )
        effective_smtp_tls = (
            tenant_in.smtp_tls
            if "smtp_tls" in tenant_in.model_fields_set
            else tenant.smtp_tls
        )
        effective_smtp_ssl = (
            tenant_in.smtp_ssl
            if "smtp_ssl" in tenant_in.model_fields_set
            else tenant.smtp_ssl
        )

        _validate_smtp_state(
            smtp_host=effective_smtp_host,
            smtp_user=effective_smtp_user,
            smtp_password_configured=smtp_password_configured,
            smtp_tls=effective_smtp_tls,
            smtp_ssl=effective_smtp_ssl,
        )

        if smtp_password_in_payload:
            password = tenant_in.smtp_password
            if password is None:
                tenant.smtp_password_encrypted = None
            elif password:
                tenant.smtp_password_encrypted = encrypt(password)
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
    new_meta_tracking_enabled = updated.meta_tracking_enabled
    new_meta_pixel_id = updated.meta_pixel_id

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

    # Invalidate current domain when public marketing config changes.
    if (
        new_meta_tracking_enabled != old_meta_tracking_enabled
        or new_meta_pixel_id != old_meta_pixel_id
    ) and new_domain:
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


@router.post("/{tenant_id}/smtp-test", response_model=TenantSmtpTestResponse)
async def send_smtp_test_email(
    tenant_id: uuid.UUID,
    body: TenantSmtpTestRequest,
    db: SessionDep,
    current_user: CurrentAdmin,
) -> TenantSmtpTestResponse:
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

    to_email = body.to_email or current_user.email
    from app.services.email import get_email_service

    success = await get_email_service().send_email(
        to=to_email,
        subject=f"SMTP test email - {tenant.name}",
        html_content=(
            "<p>This is a test email from "
            f"<strong>{escape(tenant.name)}</strong>.</p>"
            "<p>If you received it, this organization's email delivery settings "
            "are working.</p>"
        ),
        from_address=tenant.sender_email,
        from_name=tenant.sender_name,
        tenant_id=tenant.id,
        db_session=db,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send SMTP test email",
        )

    return TenantSmtpTestResponse(message=f"Test email sent to {to_email}")


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
