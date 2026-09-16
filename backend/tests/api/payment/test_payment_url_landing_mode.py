"""Exercise production redirect builders, not a copy of their URL logic."""

from unittest.mock import MagicMock

import pytest

from app.api.payment.crud import (
    _internal_open_checkout_thank_you_url,
    _resolve_open_checkout_cancel_url,
)
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import LandingMode
from app.api.tenant.utils import get_portal_url


def _make_tenant(
    *,
    slug: str = "test",
    custom_domain: str | None = "tickets.example.com",
    custom_domain_active: bool = True,
    landing_mode: LandingMode = LandingMode.portal,
) -> MagicMock:
    t = MagicMock()
    t.slug = slug
    t.custom_domain = custom_domain
    t.custom_domain_active = custom_domain_active
    t.landing_mode = landing_mode
    return t


@pytest.mark.parametrize(
    ("landing_mode", "path"),
    [
        (LandingMode.checkout, "/thank-you?payment_id=42"),
        (LandingMode.portal, "/checkout/summer-fest/thank-you?payment_id=42"),
    ],
)
def test_success_url_retains_landing_mode(landing_mode: LandingMode, path: str) -> None:
    tenant = _make_tenant(landing_mode=landing_mode)
    popup = MagicMock(slug="summer-fest")
    payment = MagicMock(id="42")

    assert (
        _internal_open_checkout_thank_you_url(
            get_portal_url(tenant), landing_mode == LandingMode.checkout, popup, payment
        )
        == f"https://tickets.example.com{path}"
    )


@pytest.mark.parametrize("landing_mode", [LandingMode.portal, LandingMode.checkout])
@pytest.mark.parametrize("flow_slug", ["checkout", "sponsors", "weekend-passes"])
@pytest.mark.parametrize("custom_domain_active", [True, False])
def test_cancel_url_returns_to_selected_flow(
    landing_mode: LandingMode, flow_slug: str, custom_domain_active: bool
) -> None:
    tenant = _make_tenant(
        landing_mode=landing_mode, custom_domain_active=custom_domain_active
    )
    popup = MagicMock(slug="summer-fest")
    flow = SalesFlows(slug=flow_slug, name="Direct sales", type="direct")
    base = get_portal_url(tenant)

    assert _resolve_open_checkout_cancel_url(flow, base, popup, locale="es") == (
        f"{base}/checkout/summer-fest/{flow_slug}?cancelled=1&lang=es"
    )


def test_cancel_url_preserves_explicit_override_verbatim() -> None:
    custom = "https://partner.example.com/cancel?source=tickets#retry"
    flow = SalesFlows(
        slug="sponsors",
        name="Sponsors",
        type="direct",
        open_checkout_cancel_url=custom,
    )

    assert (
        _resolve_open_checkout_cancel_url(
            flow,
            "https://tickets.example.com",
            MagicMock(slug="summer-fest"),
            locale="es",
        )
        == custom
    )


def test_empty_cancel_override_uses_flow_link() -> None:
    flow = SalesFlows(
        slug="sponsors",
        name="Sponsors",
        type="direct",
        open_checkout_cancel_url="",
    )

    assert (
        _resolve_open_checkout_cancel_url(
            flow,
            "https://tickets.example.com",
            MagicMock(slug="summer-fest"),
            locale="en",
        )
        == "https://tickets.example.com/checkout/summer-fest/sponsors?cancelled=1&lang=en"
    )
