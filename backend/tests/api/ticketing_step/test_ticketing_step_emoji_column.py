"""The step `emoji` field stores curated icon slugs, not just emoji.

Slugs such as ``credit-card`` and ``user-circle`` exceed the original
8-character column, so the column has to hold 32.
"""

from app.api.ticketing_step.models import TicketingSteps


def test_emoji_column_holds_32_characters() -> None:
    assert TicketingSteps.__table__.c.emoji.type.length == 32


def test_emoji_column_fits_the_longest_shipped_slugs() -> None:
    longest = max(len(slug) for slug in ("credit-card", "badge-check", "user-circle", "meal-plan"))
    assert longest <= TicketingSteps.__table__.c.emoji.type.length
