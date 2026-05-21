"""Tests that verify the _MAX rename of THIRD_PARTY scope constants.

RED-phase for Slice 1 task 1.4:
- THIRD_PARTY_TOKEN_SCOPES_MAX must be importable from app.core.security.
- THIRD_PARTY_API_KEY_SCOPES_MAX must be importable from app.core.security.
- Old names (without _MAX) must NOT be importable.
"""

from __future__ import annotations


def test_third_party_token_scopes_max_importable() -> None:
    """THIRD_PARTY_TOKEN_SCOPES_MAX is importable from app.core.security."""
    from app.core.security import THIRD_PARTY_TOKEN_SCOPES_MAX  # noqa: F401

    assert THIRD_PARTY_TOKEN_SCOPES_MAX is not None


def test_third_party_api_key_scopes_max_importable() -> None:
    """THIRD_PARTY_API_KEY_SCOPES_MAX is importable from app.core.security."""
    from app.core.security import THIRD_PARTY_API_KEY_SCOPES_MAX  # noqa: F401

    assert THIRD_PARTY_API_KEY_SCOPES_MAX is not None


def test_old_token_scopes_name_not_exportable() -> None:
    """THIRD_PARTY_TOKEN_SCOPES (without _MAX) must not exist in app.core.security."""
    import app.core.security as sec

    assert not hasattr(sec, "THIRD_PARTY_TOKEN_SCOPES"), (
        "THIRD_PARTY_TOKEN_SCOPES was not renamed to THIRD_PARTY_TOKEN_SCOPES_MAX"
    )


def test_old_api_key_scopes_name_not_exportable() -> None:
    """THIRD_PARTY_API_KEY_SCOPES (without _MAX) must not exist in app.core.security."""
    import app.core.security as sec

    assert not hasattr(sec, "THIRD_PARTY_API_KEY_SCOPES"), (
        "THIRD_PARTY_API_KEY_SCOPES was not renamed to THIRD_PARTY_API_KEY_SCOPES_MAX"
    )


def test_max_token_scopes_contains_expected_values() -> None:
    """THIRD_PARTY_TOKEN_SCOPES_MAX contains the v1 platform defaults."""
    from app.core.security import THIRD_PARTY_TOKEN_SCOPES_MAX

    assert "portal:self_read" in THIRD_PARTY_TOKEN_SCOPES_MAX
    assert "portal:directory_read" in THIRD_PARTY_TOKEN_SCOPES_MAX
    assert "portal:api_keys_manage" in THIRD_PARTY_TOKEN_SCOPES_MAX


def test_max_api_key_scopes_contains_expected_values() -> None:
    """THIRD_PARTY_API_KEY_SCOPES_MAX contains the v1 platform defaults."""
    from app.core.security import THIRD_PARTY_API_KEY_SCOPES_MAX

    assert "events:read" in THIRD_PARTY_API_KEY_SCOPES_MAX
    assert "rsvp:write" in THIRD_PARTY_API_KEY_SCOPES_MAX
