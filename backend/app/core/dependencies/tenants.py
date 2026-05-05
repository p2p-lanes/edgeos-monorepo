"""Public tenant resolver dependency for anonymous endpoints.

Resolves the tenant from request signals in priority order:
  1. Origin header
  2. Referer header (fallback when Origin is absent or opaque)
  3. X-Tenant-Id header
  4. 404 — opaque, no tenant-existence information leaked

This is NOT an auth dependency. There is no JWT, no trust boundary on the
headers. The security boundary is the tenant_id filter in every downstream
CRUD WHERE clause.
"""

import uuid as _uuid
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request, status
from loguru import logger

from app.api.tenant.crud import tenants_crud
from app.api.tenant.models import Tenants
from app.api.tenant.schemas import TenantPublic
from app.core.config import settings
from app.core.dependencies.users import SessionDep
from app.core.redis import domain_cache


def _extract_host(header_value: str | None) -> str | None:
    """Parse an Origin or Referer header into a bare hostname (lowercased, port-stripped).

    Returns None for:
    - None / empty string
    - The literal "null" (sandboxed iframes, file://, opaque origins)
    - Values that urlparse cannot reduce to a hostname
    """
    if not header_value or header_value == "null":
        return None
    try:
        parsed = urlparse(header_value)
    except (ValueError, TypeError):
        return None
    host = parsed.hostname  # urlparse strips port and lowercases automatically
    return host if host else None


def _resolve_host_with_cache(db: SessionDep, host: str, portal_domain: str) -> Tenants | None:
    """DomainCache-first tenant lookup.

    Cache stores serialized TenantPublic JSON or the sentinel string "null".

    On cache hit with valid JSON: re-fetches the live ORM Tenants instance by
    id (required because downstream callers need the real SQLAlchemy object).
    On stale cache (cached id no longer in DB): falls through to live resolution.
    On sentinel "null": returns None immediately (domain known unresolvable).
    On cache miss: calls resolve_by_host, stores result or sentinel.
    """
    cached = domain_cache.get(host)
    if cached == "null":
        return None
    if cached is not None:
        try:
            tp = TenantPublic.model_validate_json(cached)
        except (ValueError, TypeError):
            tp = None
        if tp is not None:
            tenant = tenants_crud.get(db, tp.id)
            if tenant is not None and not tenant.deleted:
                return tenant
            # Stale cache entry — fall through to live resolution

    tenant = tenants_crud.resolve_by_host(db, host, portal_domain)
    if tenant is None:
        domain_cache.set(host, "null")
        return None
    domain_cache.set(host, TenantPublic.model_validate(tenant).model_dump_json())
    return tenant


def resolve_public_tenant(
    request: Request,
    db: SessionDep,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> Tenants:
    """Resolve the tenant for an anonymous public request.

    Header resolution order:
      1. Origin — extract host, strip port, resolve via DomainCache + resolve_by_host.
      2. Referer — fallback when Origin is absent or opaque (sandboxed iframe,
         privacy proxies stripping Origin).
      3. X-Tenant-Id — last resort; treated as a UUID.
      4. 404 (opaque) + structured DEBUG log.

    Returns the live ORM Tenants instance so callers can access .id and other fields.
    """
    portal_domain = settings.PORTAL_DOMAIN

    for header_name in ("origin", "referer"):
        host = _extract_host(request.headers.get(header_name))
        if host is None:
            continue
        tenant = _resolve_host_with_cache(db, host, portal_domain)
        if tenant is not None:
            return tenant

    if x_tenant_id:
        try:
            tenant_id = _uuid.UUID(x_tenant_id)
        except ValueError:
            # Malformed UUID — treat as missing, fall through to 404
            tenant_id = None
        if tenant_id is not None:
            tenant = tenants_crud.get(db, tenant_id)
            if tenant is not None and not tenant.deleted:
                return tenant

    logger.debug(
        "resolve_public_tenant: no tenant resolved",
        origin=request.headers.get("origin"),
        referer=request.headers.get("referer"),
        x_tenant_id_present=x_tenant_id is not None,
        path=request.url.path,
    )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


PublicTenant = Annotated[Tenants, Depends(resolve_public_tenant)]
