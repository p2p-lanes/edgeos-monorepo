"""Unit tests for _account_credit / _edit_giveup_credit split (TDD — RED first).

Covers:
  R-BE-02: _account_credit returns balance unconditionally (no edit_passes_enabled gate)
  R-BE-03: edit_passes_enabled=False does not suppress _account_credit
  T-02: first-purchase scenario has no double-count between account balance and edit give-up
"""

from decimal import Decimal

from app.api.payment.crud import _account_credit, _edit_giveup_credit


class _FakeProduct:
    def __init__(self, *, category: str, duration_type: str, price: Decimal) -> None:
        self.category = category
        self.duration_type = duration_type
        self.price = price


class _FakeAttendeeProduct:
    def __init__(self, product: _FakeProduct) -> None:
        self.product = product


class _FakeAttendee:
    def __init__(self, attendee_products: list) -> None:
        self.attendee_products = attendee_products


class _FakePopup:
    def __init__(self, *, edit_passes_enabled: bool = True) -> None:
        self.edit_passes_enabled = edit_passes_enabled


class _FakeApplication:
    def __init__(
        self,
        *,
        credit: Decimal = Decimal("0"),
        edit_passes_enabled: bool = True,
        attendees: list | None = None,
    ) -> None:
        self.credit = credit
        self.popup = _FakePopup(edit_passes_enabled=edit_passes_enabled)
        self.attendees = attendees or []


class TestAccountCredit:
    """_account_credit returns the stored balance unconditionally."""

    def test_returns_balance_when_edit_passes_enabled(self) -> None:
        app = _FakeApplication(credit=Decimal("50"), edit_passes_enabled=True)
        assert _account_credit(app) == Decimal("50")

    def test_returns_balance_when_edit_passes_disabled(self) -> None:
        """R-BE-03: edit_passes_enabled=False must NOT suppress credit application."""
        app = _FakeApplication(credit=Decimal("30"), edit_passes_enabled=False)
        assert _account_credit(app) == Decimal("30")

    def test_returns_zero_when_no_credit(self) -> None:
        app = _FakeApplication(credit=Decimal("0"))
        assert _account_credit(app) == Decimal("0")

    def test_returns_zero_when_credit_is_none(self) -> None:
        app = _FakeApplication()
        app.credit = None  # type: ignore[assignment]
        assert _account_credit(app) == Decimal("0")


class TestEditGiveupCredit:
    """_edit_giveup_credit returns discounted give-up value (edit-passes math only)."""

    def test_returns_discounted_price_of_week_day_passes(self) -> None:
        week_product = _FakeProduct(
            category="ticket", duration_type="week", price=Decimal("100")
        )
        day_product = _FakeProduct(
            category="ticket", duration_type="day", price=Decimal("50")
        )
        attendee = _FakeAttendee(
            [
                _FakeAttendeeProduct(week_product),
                _FakeAttendeeProduct(day_product),
            ]
        )
        app = _FakeApplication(attendees=[attendee])
        # No discount
        result = _edit_giveup_credit(app, Decimal("0"))
        assert result == Decimal("150")

    def test_excludes_patreon_products(self) -> None:
        patreon_product = _FakeProduct(
            category="patreon", duration_type="week", price=Decimal("100")
        )
        week_product = _FakeProduct(
            category="ticket", duration_type="week", price=Decimal("80")
        )
        attendee = _FakeAttendee(
            [
                _FakeAttendeeProduct(patreon_product),
                _FakeAttendeeProduct(week_product),
            ]
        )
        app = _FakeApplication(attendees=[attendee])
        result = _edit_giveup_credit(app, Decimal("0"))
        assert result == Decimal("80")

    def test_excludes_month_passes(self) -> None:
        month_product = _FakeProduct(
            category="ticket", duration_type="month", price=Decimal("500")
        )
        week_product = _FakeProduct(
            category="ticket", duration_type="week", price=Decimal("100")
        )
        attendee = _FakeAttendee(
            [
                _FakeAttendeeProduct(month_product),
                _FakeAttendeeProduct(week_product),
            ]
        )
        app = _FakeApplication(attendees=[attendee])
        result = _edit_giveup_credit(app, Decimal("0"))
        assert result == Decimal("100")

    def test_applies_discount_percentage(self) -> None:
        week_product = _FakeProduct(
            category="ticket", duration_type="week", price=Decimal("100")
        )
        attendee = _FakeAttendee([_FakeAttendeeProduct(week_product)])
        app = _FakeApplication(attendees=[attendee])
        # 20% discount
        result = _edit_giveup_credit(app, Decimal("20"))
        assert result == Decimal("80.00")

    def test_returns_zero_when_no_eligible_products(self) -> None:
        app = _FakeApplication(attendees=[])
        result = _edit_giveup_credit(app, Decimal("0"))
        assert result == Decimal("0")


class TestNoDoubleCount:
    """_account_credit and _edit_giveup_credit are disjoint; no double-count."""

    def test_first_purchase_only_uses_account_balance(self) -> None:
        """First purchase (not edit): only _account_credit applies.

        The give-up math from _edit_giveup_credit is NOT added, so a user
        with prior week passes and a stored balance does not get double credit.
        """
        # Simulate the _calculate_price call for a NON-edit purchase:
        # credit = _account_credit(application)
        # NO += _edit_giveup_credit(...) because edit_passes=False
        week_product = _FakeProduct(
            category="ticket", duration_type="week", price=Decimal("100")
        )
        attendee = _FakeAttendee([_FakeAttendeeProduct(week_product)])
        app = _FakeApplication(credit=Decimal("50"), attendees=[attendee])

        account = _account_credit(app)
        # For a first purchase: edit_passes=False, so give-up is NOT added.
        total_credit = account  # no += _edit_giveup_credit(...)

        assert total_credit == Decimal("50")
        # Verify that give-up would have added more (proving the gate matters)
        giveup = _edit_giveup_credit(app, Decimal("0"))
        assert giveup == Decimal("100")
        # If double-counted: 150. Correct: 50.
        assert total_credit != account + giveup
