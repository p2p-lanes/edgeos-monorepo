"""Sale window conversion helpers — date ↔ datetime translation.

Public field semantics: `date` (inclusive day).
DB / ORM field semantics: `datetime` (UTC, exclusive instant).

This module is the single canonical conversion point between the two so the
inclusive-day convention lives in exactly one place.
"""

from datetime import UTC, date, datetime, time, timedelta


def datetime_to_inclusive_date(v: object, *, day_offset: int = 0) -> object:
    """Convert a stored datetime instant to the public inclusive date.

    `day_offset = -1` is the canonical setting for `sale_ends_at`, which is
    persisted as the exclusive next-day instant. Non-datetime inputs pass
    through unchanged (idempotent under repeated validation).
    """
    if isinstance(v, datetime):
        return (v + timedelta(days=day_offset)).date()
    return v


def date_to_utc_instant(v: object, *, day_offset: int = 0) -> object:
    """Convert a public inclusive date to a UTC midnight instant.

    `day_offset = 1` is the canonical setting for `sale_ends_at`, producing
    the exclusive next-day instant the DB stores. Datetime inputs pass
    through unchanged (so already-converted values stay stable).
    """
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime.combine(v + timedelta(days=day_offset), time.min, tzinfo=UTC)
    return v
