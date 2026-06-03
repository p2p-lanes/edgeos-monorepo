"""Unit tests for TenantBase/TenantUpdate/TenantPublic schema extensions (Tasks 1.2-1.5).

Covers spec scenarios: T-2, T-3, T-4 (model_validator), AC-T3.
"""

import pytest
from pydantic import ValidationError

from app.api.shared.enums import LandingMode
from app.api.tenant.schemas import TenantBase, TenantPublic, TenantUpdate

# --- Task 1.2: TenantBase has landing_mode with default portal ---


def test_tenant_base_landing_mode_default() -> None:
    """TenantBase.landing_mode defaults to LandingMode.portal."""
    tenant = TenantBase(name="Test", slug="test")
    assert tenant.landing_mode == LandingMode.portal


def test_tenant_base_landing_mode_explicit_checkout() -> None:
    tenant = TenantBase(name="Test", slug="test", landing_mode=LandingMode.checkout)
    assert tenant.landing_mode == LandingMode.checkout


# --- Task 1.3: TenantUpdate has landing_mode: LandingMode | None = None ---


def test_tenant_update_landing_mode_default_none() -> None:
    """TenantUpdate.landing_mode defaults to None (PATCH partial)."""
    update = TenantUpdate()
    assert update.landing_mode is None


def test_tenant_update_landing_mode_accepts_portal() -> None:
    update = TenantUpdate(landing_mode=LandingMode.portal)
    assert update.landing_mode == LandingMode.portal


def test_tenant_update_landing_mode_accepts_checkout_with_domain_active() -> None:
    """Payload-level: checkout allowed when custom_domain_active=True (not False)."""
    update = TenantUpdate(
        landing_mode=LandingMode.checkout,
        custom_domain_active=True,
        custom_domain="tickets.example.com",
    )
    assert update.landing_mode == LandingMode.checkout


# --- Task 1.4: model_validator rejects checkout when custom_domain_active=False ---


def test_tenant_update_validator_rejects_checkout_when_domain_inactive() -> None:
    """Scenario T-2: landing_mode=checkout rejected when custom_domain_active=False."""
    with pytest.raises(ValidationError, match="custom_domain_active"):
        TenantUpdate(
            landing_mode=LandingMode.checkout,
            custom_domain_active=False,
        )


def test_tenant_update_validator_schema_allows_checkout_when_domain_absent_in_payload() -> (
    None
):
    """Scenario T-3 (schema-level): custom_domain=None in payload = 'not changing'.

    When custom_domain is absent from the payload (None), the schema defers to the
    router merged-state check (ADR-1). Schema rejection only fires when custom_domain_active
    is explicitly True in the payload but custom_domain is missing — see the
    test_tenant_update_validator_rejects_when_active_true_but_no_domain test.

    The router is responsible for rejecting checkout when the DB row has no custom_domain.
    """
    # landing_mode=checkout with custom_domain unset in payload — schema passes (defers to router)
    update = TenantUpdate(landing_mode=LandingMode.checkout)
    assert update.landing_mode == LandingMode.checkout


def test_tenant_update_validator_allows_checkout_with_domain_and_active() -> None:
    """Scenario T-4: checkout accepted when domain is set and active in the same payload."""
    update = TenantUpdate(
        landing_mode=LandingMode.checkout,
        custom_domain_active=True,
        custom_domain="tickets.example.com",
    )
    assert update.landing_mode == LandingMode.checkout


def test_tenant_update_validator_rejects_when_active_true_but_no_domain() -> None:
    """Payload has custom_domain_active=True but no custom_domain in payload.

    When custom_domain_active is explicitly True (meaning: this PATCH is also
    activating the domain) but no custom_domain is provided, schema rejects it.
    """
    with pytest.raises(ValidationError, match="custom_domain"):
        TenantUpdate(
            landing_mode=LandingMode.checkout,
            custom_domain_active=True,
            # custom_domain intentionally omitted → None in payload
        )


def test_tenant_update_validator_allows_checkout_mode_only_in_payload() -> None:
    """PATCH {"landing_mode": "checkout"} alone is valid at schema level.

    The schema defers to the router for the merged-state check (ADR-1).
    A payload of just landing_mode=checkout is allowed by the schema so the
    router can check the DB row for the current domain state.
    """
    update = TenantUpdate(landing_mode=LandingMode.checkout)
    assert update.landing_mode == LandingMode.checkout


# --- Task 1.5: TenantPublic has active_popup_slug ---


def test_tenant_public_has_active_popup_slug_field() -> None:
    """TenantPublic exposes active_popup_slug, defaulting to None."""
    import uuid

    tenant = TenantPublic(
        id=uuid.uuid4(),
        name="Test",
        slug="test",
        custom_domain_active=False,
    )
    assert tenant.active_popup_slug is None


def test_tenant_public_active_popup_slug_can_be_set() -> None:
    import uuid

    tenant = TenantPublic(
        id=uuid.uuid4(),
        name="Test",
        slug="test",
        custom_domain_active=False,
        active_popup_slug="summer-fest",
    )
    assert tenant.active_popup_slug == "summer-fest"


def test_tenant_public_includes_landing_mode() -> None:
    """TenantPublic inherits landing_mode from TenantBase."""
    import uuid

    tenant = TenantPublic(
        id=uuid.uuid4(),
        name="Test",
        slug="test",
        custom_domain_active=False,
        landing_mode=LandingMode.checkout,
    )
    assert tenant.landing_mode == LandingMode.checkout


def test_tenant_base_does_not_have_active_popup_slug() -> None:
    """active_popup_slug is NOT on TenantBase — it's a projection field only."""
    assert not hasattr(TenantBase(name="T", slug="t"), "active_popup_slug")
