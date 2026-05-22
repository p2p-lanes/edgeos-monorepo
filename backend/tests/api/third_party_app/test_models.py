"""Model import + default field contract tests for ThirdPartyApps.

RED-phase for Slice 1 tasks 1.1 / 1.7.
Tests fail until ThirdPartyApps model is created.
"""

from __future__ import annotations


def test_third_party_apps_importable() -> None:
    """ThirdPartyApps can be imported from its module."""
    from app.api.third_party_app.models import ThirdPartyApps  # noqa: F401


def test_default_allowed_token_scopes_is_empty_list() -> None:
    """allowed_token_scopes defaults to empty list."""
    from app.api.third_party_app.models import ThirdPartyApps

    app = ThirdPartyApps(
        tenant_id="00000000-0000-0000-0000-000000000001",
        name="test",
        key_hash="abc",
        prefix="abc",
    )
    assert app.allowed_token_scopes == []


def test_default_allowed_api_key_scopes_is_empty_list() -> None:
    """allowed_api_key_scopes defaults to empty list."""
    from app.api.third_party_app.models import ThirdPartyApps

    app = ThirdPartyApps(
        tenant_id="00000000-0000-0000-0000-000000000001",
        name="test",
        key_hash="abc",
        prefix="abc",
    )
    assert app.allowed_api_key_scopes == []


def test_active_defaults_true() -> None:
    """active defaults to True."""
    from app.api.third_party_app.models import ThirdPartyApps

    app = ThirdPartyApps(
        tenant_id="00000000-0000-0000-0000-000000000001",
        name="test",
        key_hash="abc",
        prefix="abc",
    )
    assert app.active is True


def test_revoked_at_defaults_none() -> None:
    """revoked_at defaults to None."""
    from app.api.third_party_app.models import ThirdPartyApps

    app = ThirdPartyApps(
        tenant_id="00000000-0000-0000-0000-000000000001",
        name="test",
        key_hash="abc",
        prefix="abc",
    )
    assert app.revoked_at is None


def test_table_name() -> None:
    """Table name is 'third_party_apps'."""
    from app.api.third_party_app.models import ThirdPartyApps

    assert ThirdPartyApps.__tablename__ == "third_party_apps"
