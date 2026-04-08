"""Tenant-specific utility helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.core.config import settings

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants


def get_portal_url(tenant: Tenants) -> str:
    """Return the portal base URL for a tenant.

    If the tenant has an active custom domain, returns
    ``https://{custom_domain}``.  Otherwise falls back to the subdomain
    pattern ``https://{slug}.{portal_host}`` derived from ``settings.PORTAL_URL``.
    """
    if tenant.custom_domain_active and tenant.custom_domain:
        return f"https://{tenant.custom_domain}"

    # Strip scheme from PORTAL_URL and use as the base domain.
    portal_host = (
        settings.PORTAL_URL.replace("https://", "").replace("http://", "").rstrip("/")
    )
    return f"https://{tenant.slug}.{portal_host}"
