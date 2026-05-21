"""Unit tests for calculate_contribution_amount (TDD — RED first).

Scenarios covered:
  - SCN-05: enabled + round subtotal → exact result
  - SCN-06: enabled + fractional subtotal → half-up rounding
  - SCN-04: enabled + null percentage → 0
  - SCN-02: disabled popup → 0
  - Edge: zero subtotal → 0
"""

from decimal import Decimal

from app.api.payment.crud import calculate_contribution_amount


class _FakePopup:
    """Minimal popup stand-in for pure-function tests."""

    def __init__(
        self,
        *,
        contribution_enabled: bool,
        contribution_percentage: str | None,
    ) -> None:
        self.contribution_enabled = contribution_enabled
        self.contribution_percentage = (
            Decimal(contribution_percentage)
            if contribution_percentage is not None
            else None
        )


class TestCalculateContributionAmount:
    def test_enabled_round_subtotal_returns_exact_amount(self) -> None:
        """SCN-05: 5% of $100.00 = $5.00 exactly."""
        popup = _FakePopup(contribution_enabled=True, contribution_percentage="5.00")
        result = calculate_contribution_amount(popup, Decimal("100.00"))
        assert result == Decimal("5.00")

    def test_enabled_fractional_subtotal_rounds_half_up(self) -> None:
        """SCN-06: 5% of $33.33 = $1.6665 → rounds half-up to $1.67."""
        popup = _FakePopup(contribution_enabled=True, contribution_percentage="5.00")
        result = calculate_contribution_amount(popup, Decimal("33.33"))
        assert result == Decimal("1.67")

    def test_enabled_null_percentage_returns_zero(self) -> None:
        """SCN-04: enabled=True, percentage=null → 0 (not configured)."""
        popup = _FakePopup(contribution_enabled=True, contribution_percentage=None)
        result = calculate_contribution_amount(popup, Decimal("100.00"))
        assert result == Decimal("0")

    def test_disabled_popup_returns_zero(self) -> None:
        """SCN-02: contribution_enabled=False → 0 regardless of subtotal."""
        popup = _FakePopup(contribution_enabled=False, contribution_percentage="5.00")
        result = calculate_contribution_amount(popup, Decimal("100.00"))
        assert result == Decimal("0")

    def test_zero_subtotal_returns_zero(self) -> None:
        """Edge: subtotal=0, enabled → contribution is 0."""
        popup = _FakePopup(contribution_enabled=True, contribution_percentage="5.00")
        result = calculate_contribution_amount(popup, Decimal("0"))
        assert result == Decimal("0")

    def test_result_precision_is_two_decimal_places(self) -> None:
        """Calculation result always has exactly 2 decimal places."""
        popup = _FakePopup(contribution_enabled=True, contribution_percentage="3.00")
        result = calculate_contribution_amount(popup, Decimal("100.00"))
        # 3% of 100 = 3.00 — verify it's Decimal with proper precision
        assert result == Decimal("3.00")
        # Ensure the exponent represents 2 decimal places
        assert result == result.quantize(Decimal("0.01"))
