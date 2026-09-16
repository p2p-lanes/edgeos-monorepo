"""Nightly pricing: pure domain, no database.

Covers the rules from the plan §3.2: default price, date-range overrides,
priority between overlapping rules, the long-stay (monthly) rate and its
calendar-based threshold, itemised tax and rounding.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

import pytest

from app.api.accommodation.constants import (
    RULE_DEFAULT,
    RULE_LONG_STAY,
    RULE_RANGE_PREFIX,
)
from app.api.accommodation.pricing import (
    PriceRuleSpec,
    nights_between,
    qualifies_for_long_stay,
    quote_stay,
)


def _rule(
    start: date,
    end: date,
    price: str,
    *,
    priority: int = 0,
    created_at: datetime | None = None,
    rule_id: uuid.UUID | None = None,
) -> PriceRuleSpec:
    return PriceRuleSpec(
        start_date=start,
        end_date=end,
        nightly_price=Decimal(price),
        priority=priority,
        id=rule_id or uuid.uuid4(),
        created_at=created_at,
    )


class TestNightsBetween:
    def test_half_open_range_excludes_checkout_day(self) -> None:
        nights = nights_between(date(2026, 6, 1), date(2026, 6, 8))
        assert len(nights) == 7
        assert nights[0] == date(2026, 6, 1)
        assert nights[-1] == date(2026, 6, 7)

    def test_same_day_is_no_nights(self) -> None:
        assert nights_between(date(2026, 6, 1), date(2026, 6, 1)) == []

    def test_inverted_range_is_no_nights(self) -> None:
        assert nights_between(date(2026, 6, 8), date(2026, 6, 1)) == []


class TestDefaultPricing:
    def test_flat_default_price(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 8),
            default_nightly_price=Decimal("120"),
        )
        assert quote.night_count == 7
        assert quote.subtotal == Decimal("840.00")
        assert quote.total == Decimal("840.00")
        assert quote.applied_rule == RULE_DEFAULT
        assert all(night.rule == RULE_DEFAULT for night in quote.nights)

    def test_empty_range_raises(self) -> None:
        with pytest.raises(ValueError):
            quote_stay(
                check_in=date(2026, 6, 8),
                check_out=date(2026, 6, 8),
                default_nightly_price=Decimal("120"),
            )


class TestDateRangeRules:
    def test_rule_prices_only_the_nights_it_covers(self) -> None:
        # A rule for Jun 12-14 prices the nights of the 12th, 13th and 14th.
        rule = _rule(date(2026, 6, 12), date(2026, 6, 14), "140")
        quote = quote_stay(
            check_in=date(2026, 6, 11),
            check_out=date(2026, 6, 15),
            default_nightly_price=Decimal("120"),
            price_rules=[rule],
        )
        prices = [night.price for night in quote.nights]
        assert prices == [
            Decimal("120.00"),
            Decimal("140.00"),
            Decimal("140.00"),
            Decimal("140.00"),
        ]
        assert quote.subtotal == Decimal("540.00")
        assert quote.applied_rule == "mixed"

    def test_single_rule_covering_whole_stay_is_reported_as_that_rule(self) -> None:
        rule_id = uuid.uuid4()
        rule = _rule(date(2026, 6, 1), date(2026, 6, 30), "95", rule_id=rule_id)
        quote = quote_stay(
            check_in=date(2026, 6, 3),
            check_out=date(2026, 6, 6),
            default_nightly_price=Decimal("120"),
            price_rules=[rule],
        )
        assert quote.applied_rule == f"{RULE_RANGE_PREFIX}{rule_id}"
        assert quote.subtotal == Decimal("285.00")

    def test_higher_priority_wins_on_overlap(self) -> None:
        season = _rule(date(2026, 6, 1), date(2026, 6, 30), "150", priority=0)
        promo = _rule(date(2026, 6, 5), date(2026, 6, 6), "90", priority=10)
        quote = quote_stay(
            check_in=date(2026, 6, 5),
            check_out=date(2026, 6, 7),
            default_nightly_price=Decimal("120"),
            price_rules=[season, promo],
        )
        assert [night.price for night in quote.nights] == [
            Decimal("90.00"),
            Decimal("90.00"),
        ]

    def test_equal_priority_breaks_on_newest_rule(self) -> None:
        older = _rule(
            date(2026, 6, 1),
            date(2026, 6, 30),
            "150",
            created_at=datetime(2026, 1, 1),
        )
        newer = _rule(
            date(2026, 6, 1),
            date(2026, 6, 30),
            "110",
            created_at=datetime(2026, 5, 1),
        )
        quote = quote_stay(
            check_in=date(2026, 6, 5),
            check_out=date(2026, 6, 6),
            default_nightly_price=Decimal("120"),
            price_rules=[older, newer],
        )
        assert quote.nights[0].price == Decimal("110.00")

    def test_rule_outside_the_stay_is_ignored(self) -> None:
        rule = _rule(date(2026, 7, 1), date(2026, 7, 10), "300")
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 3),
            default_nightly_price=Decimal("120"),
            price_rules=[rule],
        )
        assert quote.subtotal == Decimal("240.00")
        assert quote.applied_rule == RULE_DEFAULT


class TestLongStay:
    """C5: the monthly rate applies when the stay covers the check-in month."""

    def test_thirty_nights_in_june_qualifies(self) -> None:
        assert qualifies_for_long_stay(
            date(2026, 6, 1), date(2026, 7, 1), Decimal("70")
        )

    def test_thirty_nights_in_july_does_not_qualify(self) -> None:
        # July has 31 days, so 30 nights is not a full month.
        assert not qualifies_for_long_stay(
            date(2026, 7, 1), date(2026, 7, 31), Decimal("70")
        )

    def test_february_threshold_is_twenty_eight(self) -> None:
        assert qualifies_for_long_stay(
            date(2026, 2, 1), date(2026, 3, 1), Decimal("70")
        )

    def test_february_leap_year_threshold_is_twenty_nine(self) -> None:
        assert not qualifies_for_long_stay(
            date(2028, 2, 1), date(2028, 2, 29), Decimal("70")
        )
        assert qualifies_for_long_stay(
            date(2028, 2, 1), date(2028, 3, 1), Decimal("70")
        )

    def test_without_a_long_stay_price_it_never_applies(self) -> None:
        assert not qualifies_for_long_stay(date(2026, 6, 1), date(2026, 7, 1), None)

    def test_long_stay_overrides_range_rules(self) -> None:
        # A high-season rule must not survive the monthly rate: the whole
        # stay is charged flat, which is the promise made in the checkout.
        season = _rule(date(2026, 6, 1), date(2026, 6, 30), "200", priority=99)
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 7, 1),
            default_nightly_price=Decimal("120"),
            long_stay_price=Decimal("70"),
            price_rules=[season],
        )
        assert quote.night_count == 30
        assert quote.subtotal == Decimal("2100.00")
        assert quote.applied_rule == RULE_LONG_STAY
        assert all(night.rule == RULE_LONG_STAY for night in quote.nights)

    def test_short_stay_ignores_the_long_stay_price(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 8),
            default_nightly_price=Decimal("120"),
            long_stay_price=Decimal("70"),
        )
        assert quote.applied_rule == RULE_DEFAULT
        assert quote.subtotal == Decimal("840.00")


class TestTaxAndRounding:
    def test_tax_is_itemised_not_folded_into_nights(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 8),
            default_nightly_price=Decimal("120"),
            tax_percentage=Decimal("12"),
        )
        assert quote.subtotal == Decimal("840.00")
        assert quote.tax == Decimal("100.80")
        assert quote.total == Decimal("940.80")
        assert quote.tax_percentage == Decimal("12")
        assert all(night.price == Decimal("120.00") for night in quote.nights)

    def test_no_tax_configured_leaves_the_total_untouched(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 3),
            default_nightly_price=Decimal("120"),
        )
        assert quote.tax == Decimal("0.00")
        assert quote.tax_percentage is None
        assert quote.total == quote.subtotal

    def test_zero_tax_percentage_behaves_like_no_tax(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 3),
            default_nightly_price=Decimal("120"),
            tax_percentage=Decimal("0"),
        )
        assert quote.tax == Decimal("0.00")
        assert quote.total == Decimal("240.00")

    def test_per_night_rounding_is_half_up(self) -> None:
        # 33.335 -> 33.34 per night, not 33.33 (banker's rounding would
        # silently under-charge by a cent per night).
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 4),
            default_nightly_price=Decimal("33.335"),
        )
        assert [night.price for night in quote.nights] == [Decimal("33.34")] * 3
        assert quote.subtotal == Decimal("100.02")

    def test_tax_rounding_is_half_up(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 2),
            default_nightly_price=Decimal("100.05"),
            tax_percentage=Decimal("10"),
        )
        assert quote.subtotal == Decimal("100.05")
        assert quote.tax == Decimal("10.01")
        assert quote.total == Decimal("110.06")

    def test_currency_is_echoed_back(self) -> None:
        quote = quote_stay(
            check_in=date(2026, 6, 1),
            check_out=date(2026, 6, 2),
            default_nightly_price=Decimal("100"),
            currency="ARS",
        )
        assert quote.currency == "ARS"
