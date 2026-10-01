"""Tenant-specific utility helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

from app.core.config import settings

if TYPE_CHECKING:
    from app.api.tenant.models import Tenants


def get_portal_url(tenant: Tenants) -> str:
    """Return the portal base URL for a tenant.

    If the tenant has an active custom domain, returns
    ``https://{custom_domain}``.  Otherwise falls back to the subdomain
    pattern ``{scheme}://{slug}.{portal_host}`` from ``settings.PORTAL_URL``.
    """
    if tenant.custom_domain_active and tenant.custom_domain:
        return f"https://{tenant.custom_domain}"

    base = settings.PORTAL_URL
    portal = urlsplit(base if "://" in base else f"https://{base}")
    return urlunsplit(
        (
            portal.scheme,
            f"{tenant.slug}.{portal.netloc}",
            portal.path.rstrip("/"),
            "",
            "",
        )
    )
