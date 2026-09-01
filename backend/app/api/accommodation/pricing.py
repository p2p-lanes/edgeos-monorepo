"""Nightly pricing for accommodations: pure functions, no database.

Everything that decides *how much a stay costs* lives here so the same code
answers the checkout preview, the server-side revalidation at purchase time
and the tests. The client never sends a price; it only sends dates.

Price resolution, per night:

1. If the accommodation has a ``long_stay_price`` and the stay covers a whole
   month (C5: ``nights >= days_in_month(check_in)``), every night is charged
   at that flat rate and no range rule is consulted.
2. Otherwise the highest-priority :class:`PriceRuleSpec` covering the night
   wins; ties break on the most recently created rule.
3. Otherwise ``default_nightly_price``.

Tax (C3) is an optional percentage on the *property*, applied to the nightly
subtotal and itemised, never folded into the per-night price.
"""

import calendar
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.api.accommodation.constants import (
    RULE_DEFAULT,
    RULE_LONG_STAY,
    RULE_RANGE_PREFIX,
)
from app.api.accommodation.schemas import AccommodationQuote, QuoteNight

MONEY = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    """Round half-up to cents. Half-up, not banker's, so totals match what an
    admin computes by hand."""
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PriceRuleSpec:
    """A date-range price rule, detached from the ORM so pricing stays pure.

    ``start_date`` and ``end_date`` are both inclusive: a rule for a weekend
    is ``Jun 5 -> Jun 6`` and prices the nights *of* the 5th and the 6th.
    """

    start_date: date
    end_date: date
    nightly_price: Decimal
    priority: int = 0
    id: uuid.UUID | None = None
    created_at: datetime | None = None

    def covers(self, night: date) -> bool:
        return self.start_date <= night <= self.end_date

    @property
    def label(self) -> str:
        return f"{RULE_RANGE_PREFIX}{self.id}" if self.id else RULE_RANGE_PREFIX[:-1]


def price_rules_from_models(rules: Iterable[object]) -> list[PriceRuleSpec]:
    """Adapt ``AccommodationPriceRules`` rows to :class:`PriceRuleSpec`."""
    return [
        PriceRuleSpec(
            start_date=rule.start_date,  # type: ignore[attr-defined]
            end_date=rule.end_date,  # type: ignore[attr-defined]
            nightly_price=Decimal(rule.nightly_price),  # type: ignore[attr-defined]
            priority=rule.priority,  # type: ignore[attr-defined]
            id=rule.id,  # type: ignore[attr-defined]
            created_at=getattr(rule, "created_at", None),
        )
        for rule in rules
    ]


def nights_between(check_in: date, check_out: date) -> list[date]:
    """The nights actually slept in ``[check_in, check_out)``.

    A Jun 1 -> Jun 8 stay is 7 nights: the check-out day is not charged, which
    is also what makes same-day turnover possible.
    """
    if check_out <= check_in:
        return []
    return [
        check_in + timedelta(days=offset)
        for offset in range((check_out - check_in).days)
    ]


def qualifies_for_long_stay(
    check_in: date, check_out: date, long_stay_price: Decimal | None
) -> bool:
    """Whether the monthly rate applies (C5).

    The threshold is the length of the *check-in* month, so a 30-night stay
    starting in June qualifies while the same 30 nights starting in July
    (31 days) does not. Deliberately calendar-based rather than a fixed 28/30
    so "a month" means what the organiser means by it.
    """
    if long_stay_price is None:
        return False
    nights = len(nights_between(check_in, check_out))
    if nights <= 0:
        return False
    return nights >= calendar.monthrange(check_in.year, check_in.month)[1]


def _resolve_night(
    night: date, rules: Sequence[PriceRuleSpec], default_price: Decimal
) -> tuple[Decimal, str]:
    """Price of one night plus the label of the rule that produced it."""
    matching = [rule for rule in rules if rule.covers(night)]
    if not matching:
        return _money(default_price), RULE_DEFAULT

    # Highest priority wins; ties break on the newest rule so an admin can
    # layer a promo over an existing season without renumbering priorities.
    winner = max(
        matching,
        key=lambda rule: (
            rule.priority,
            rule.created_at or datetime.min,
        ),
    )
    return _money(winner.nightly_price), winner.label


def _summarise(night_labels: Sequence[str]) -> str:
    distinct = set(night_labels)
    if len(distinct) == 1:
        return next(iter(distinct))
    return "mixed"


def quote_stay(
    *,
    check_in: date,
    check_out: date,
    default_nightly_price: Decimal,
    long_stay_price: Decimal | None = None,
    price_rules: Sequence[PriceRuleSpec] = (),
    tax_percentage: Decimal | None = None,
    currency: str | None = None,
) -> AccommodationQuote:
    """Price a stay. Raises ``ValueError`` on an empty or inverted range."""
    stay_nights = nights_between(check_in, check_out)
    if not stay_nights:
        raise ValueError("check_out must be after check_in")

    if qualifies_for_long_stay(check_in, check_out, long_stay_price):
        per_night = _money(long_stay_price)  # type: ignore[arg-type]
        breakdown = [
            QuoteNight(date=night, price=per_night, rule=RULE_LONG_STAY)
            for night in stay_nights
        ]
    else:
        breakdown = []
        for night in stay_nights:
            price, rule = _resolve_night(night, price_rules, default_nightly_price)
            breakdown.append(QuoteNight(date=night, price=price, rule=rule))

    subtotal = _money(sum((entry.price for entry in breakdown), Decimal("0")))

    tax = Decimal("0.00")
    if tax_percentage:
        tax = _money(subtotal * Decimal(tax_percentage) / Decimal("100"))

    return AccommodationQuote(
        nights=breakdown,
        night_count=len(breakdown),
        subtotal=subtotal,
        tax_percentage=Decimal(tax_percentage) if tax_percentage else None,
        tax=tax,
        total=_money(subtotal + tax),
        applied_rule=_summarise([entry.rule for entry in breakdown]),
        currency=currency,
    )


def quote_accommodation(
    accommodation: object,
    price_rules: Iterable[object],
    check_in: date,
    check_out: date,
    *,
    tax_percentage: Decimal | None = None,
    currency: str | None = None,
) -> AccommodationQuote:
    """ORM-facing wrapper around :func:`quote_stay`.

    ``tax_percentage`` comes from the property, not the accommodation, and is
    passed in by the caller that already loaded it.
    """
    return quote_stay(
        check_in=check_in,
        check_out=check_out,
        default_nightly_price=Decimal(accommodation.default_nightly_price),  # type: ignore[attr-defined]
        long_stay_price=(
            Decimal(accommodation.long_stay_price)  # type: ignore[attr-defined]
            if accommodation.long_stay_price is not None  # type: ignore[attr-defined]
            else None
        ),
        price_rules=price_rules_from_models(price_rules),
        tax_percentage=tax_percentage,
        currency=currency,
    )
