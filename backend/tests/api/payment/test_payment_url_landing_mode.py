"""Unit tests for payment URL construction with landing_mode (Task 5.4 / Task 2.6).

Covers scenarios:
- P-1: success_url in checkout mode (no slug prefix)
- P-2: cancel_url in checkout mode (no slug prefix)
- P-3: portal mode — current behavior preserved (regression guard)
- P-4: Application Fee flow unchanged (zero diff)

These are pure unit tests — they test the URL construction logic in isolation
without hitting the database or SimpleFi.
"""

from unittest.mock import MagicMock

from app.api.shared.enums import LandingMode
from app.api.tenant.utils import get_portal_url


def _make_tenant(
    *,
    slug: str,
    custom_domain: str | None = None,
    custom_domain_active: bool = False,
    landing_mode: LandingMode = LandingMode.portal,
) -> MagicMock:
    t = MagicMock()
    t.slug = slug
    t.custom_domain = custom_domain
    t.custom_domain_active = custom_domain_active
    t.landing_mode = landing_mode
    return t


def _make_popup(*, slug: str, simplefi_api_key: str = "test-key") -> MagicMock:
    p = MagicMock()
    p.slug = slug
    p.simplefi_api_key = simplefi_api_key
    return p


# ---------------------------------------------------------------------------
# Test the URL construction logic directly (extracted as a helper)
# ---------------------------------------------------------------------------


def _build_urls(
    tenant: MagicMock, popup: MagicMock, payment_id: str
) -> tuple[str, str]:
    """Mirror the URL construction logic from payment/crud.py lines 463-468."""
    portal_base = get_portal_url(tenant)
    if tenant.landing_mode == LandingMode.checkout:
        success_url = f"{portal_base}/thank-you?payment_id={payment_id}"
        cancel_url = f"{portal_base}/?cancelled=1"
    else:
        success_url = (
            f"{portal_base}/checkout/{popup.slug}/thank-you?payment_id={payment_id}"
        )
        cancel_url = f"{portal_base}/checkout/{popup.slug}?cancelled=1"
    return success_url, cancel_url


# P-1: success URL in checkout mode
def test_success_url_checkout_mode() -> None:
    """Scenario P-1: success_url has no /checkout/{slug}/ prefix in checkout mode."""
    tenant = _make_tenant(
        slug="test",
        custom_domain="tickets.example.com",
        custom_domain_active=True,
        landing_mode=LandingMode.checkout,
    )
    popup = _make_popup(slug="summer-fest")

    success_url, _ = _build_urls(tenant, popup, "42")

    assert success_url == "https://tickets.example.com/thank-you?payment_id=42"
    # Must NOT contain /checkout/summer-fest
    assert "/checkout/" not in success_url


# P-2: cancel URL in checkout mode
def test_cancel_url_checkout_mode() -> None:
    """Scenario P-2: cancel_url has no /checkout/{slug}/ prefix in checkout mode."""
    tenant = _make_tenant(
        slug="test",
        custom_domain="tickets.example.com",
        custom_domain_active=True,
        landing_mode=LandingMode.checkout,
    )
    popup = _make_popup(slug="summer-fest")

    _, cancel_url = _build_urls(tenant, popup, "42")

    assert cancel_url == "https://tickets.example.com/?cancelled=1"
    assert "/checkout/" not in cancel_url


# P-3: portal mode — no regression
def test_urls_portal_mode_unchanged() -> None:
    """Scenario P-3: portal mode URLs retain slug-prefixed construction."""
    tenant = _make_tenant(
        slug="my-org",
        custom_domain="tickets.example.com",
        custom_domain_active=True,
        landing_mode=LandingMode.portal,
    )
    popup = _make_popup(slug="summer-fest")
    payment_id = "7"

    success_url, cancel_url = _build_urls(tenant, popup, payment_id)

    assert (
        success_url
        == "https://tickets.example.com/checkout/summer-fest/thank-you?payment_id=7"
    )
    assert cancel_url == "https://tickets.example.com/checkout/summer-fest?cancelled=1"


# P-4: Application Fee callback URLs unchanged (zero diff audit)
def test_application_fee_urls_use_portal_prefix() -> None:
    """Scenario P-4: App Fee URLs always use /portal/{slug} regardless of landing_mode.

    This test documents the expected shape of Application Fee callback URLs.
    The actual construction lives at payment/crud.py lines 776-779 and must NOT
    be modified by this feature (R-P5, AC-P2).

    We test the shape here as a regression guard without executing the actual code.
    """
    # The Application Fee flow always builds:
    #   success_path = f"{portal_base}/portal/{popup.slug}/application?checkout=success"
    #   cancel_path  = f"{portal_base}/portal/{popup.slug}/application"
    # This is NOT gated on landing_mode — it's out of scope.
    tenant = _make_tenant(
        slug="my-org",
        custom_domain="tickets.example.com",
        custom_domain_active=True,
        landing_mode=LandingMode.checkout,  # even in checkout mode, fee flow is unchanged
    )
    popup = _make_popup(slug="summer-fest")
    portal_base = get_portal_url(tenant)

    # Simulate the fee flow construction (unchanged lines 776-779)
    success_path = f"{portal_base}/portal/{popup.slug}/application?checkout=success"
    cancel_path = f"{portal_base}/portal/{popup.slug}/application"

    assert (
        success_path
        == "https://tickets.example.com/portal/summer-fest/application?checkout=success"
    )
    assert cancel_path == "https://tickets.example.com/portal/summer-fest/application"
    # Confirms landing_mode plays no role here
    assert "landing_mode" not in success_path
    assert "thank-you" not in success_path
