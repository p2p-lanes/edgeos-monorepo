"""Unit tests for LandingMode enum (Task 1.1 — RED phase)."""

from app.api.shared.enums import LandingMode


def test_landing_mode_values() -> None:
    assert LandingMode.portal == "portal"
    assert LandingMode.checkout == "checkout"


def test_landing_mode_is_strenum() -> None:
    from enum import StrEnum

    assert issubclass(LandingMode, StrEnum)


def test_landing_mode_default_is_portal() -> None:
    """portal is the first member — used as schema default."""
    assert list(LandingMode)[0] == LandingMode.portal
