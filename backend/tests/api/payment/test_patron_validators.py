"""Unit tests for validate_patron_amount helper in payment/crud.py.

Spec: patron-product Requirement: Patron Amount Validated Against template_config
Constraint #1360: values are raw popup-currency units — NO /100 conversion.
"""

from decimal import Decimal

import pytest
from fastapi import HTTPException


class TestValidatePatronAmount:
    """validate_patron_amount raises HTTPException(422) on violations."""

    @pytest.fixture(autouse=True)
    def import_validator(self):
        from app.api.payment.crud import validate_patron_amount

        self.validate = validate_patron_amount

    def test_amount_equals_minimum_passes(self) -> None:
        """amount == minimum is the boundary — must pass."""
        template_config = {
            "minimum": 1000,
            "allow_custom": True,
            "presets": [2500, 5000],
        }
        self.validate(Decimal("1000"), template_config)  # no exception

    def test_amount_above_minimum_passes(self) -> None:
        """amount > minimum passes when allow_custom is True."""
        template_config = {
            "minimum": 1000,
            "allow_custom": True,
            "presets": [2500, 5000],
        }
        self.validate(Decimal("3000"), template_config)

    def test_amount_below_minimum_raises_422(self) -> None:
        """amount < minimum must raise HTTPException 422."""
        template_config = {
            "minimum": 1000,
            "allow_custom": True,
            "presets": [2500, 5000],
        }
        with pytest.raises(HTTPException) as exc_info:
            self.validate(Decimal("999"), template_config)
        assert exc_info.value.status_code == 422
        assert (
            "minimum" in exc_info.value.detail.lower()
            or "1000" in exc_info.value.detail
        )

    def test_amount_in_presets_when_allow_custom_false_passes(self) -> None:
        """Preset amount passes when allow_custom=False."""
        template_config = {
            "minimum": 1000,
            "allow_custom": False,
            "presets": [2500, 5000],
        }
        self.validate(Decimal("5000"), template_config)  # no exception

    def test_amount_not_in_presets_when_allow_custom_false_raises_422(self) -> None:
        """Custom amount not in presets raises 422 when allow_custom=False."""
        template_config = {
            "minimum": 1000,
            "allow_custom": False,
            "presets": [2500, 5000],
        }
        with pytest.raises(HTTPException) as exc_info:
            self.validate(Decimal("3000"), template_config)
        assert exc_info.value.status_code == 422
        assert (
            "preset" in exc_info.value.detail.lower()
            or "valid" in exc_info.value.detail.lower()
        )

    def test_custom_amount_when_allow_custom_true_passes(self) -> None:
        """Any amount >= minimum passes when allow_custom=True."""
        template_config = {
            "minimum": 1000,
            "allow_custom": True,
            "presets": [2500, 5000],
        }
        self.validate(Decimal("9999"), template_config)  # no exception

    def test_units_are_raw_not_cents(self) -> None:
        """Confirm: minimum=1000 means 1000 currency units (e.g. $1000), not $10.

        1000 / 100 = 10. If the validator did cents conversion, amount=999 would pass
        (as 9.99 > 10.00 is false, but 999 < 1000). This test locks the raw-units contract.
        """
        template_config = {"minimum": 1000, "allow_custom": True, "presets": []}
        # 999 raw units < 1000 raw units: must fail
        with pytest.raises(HTTPException):
            self.validate(Decimal("999"), template_config)
        # 1000 raw units == 1000 raw units: must pass
        self.validate(Decimal("1000"), template_config)

    def test_missing_minimum_key_skips_floor_check(self) -> None:
        """A template_config without `minimum` enforces no floor.

        Admin may configure a patron step without setting a minimum. The validator
        treats this as "any amount is acceptable" rather than crashing.
        """
        template_config = {"allow_custom": True, "presets": []}
        self.validate(Decimal("1"), template_config)
        self.validate(Decimal("999999"), template_config)

    def test_null_minimum_skips_floor_check(self) -> None:
        """An explicit `minimum: None` is treated the same as missing."""
        template_config = {"minimum": None, "allow_custom": True, "presets": []}
        self.validate(Decimal("1"), template_config)


class TestResolvePatronTemplateConfig:
    """resolve_patron_template_config returns dict or None."""

    def test_import_succeeds(self) -> None:
        """The helper must be importable from payment.crud."""
        from app.api.payment.crud import resolve_patron_template_config  # noqa: F401
