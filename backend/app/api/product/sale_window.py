"""Sale window conversion helper.

The sale window (``sale_starts_at`` / ``sale_ends_at``) is a precise ``datetime``
instant, both in the API and in the DB. Datetimes pass through untouched; a bare
``date`` (e.g. from a CSV import) is anchored to UTC midnight.
"""

from datetime import UTC, date, datetime, time, timedelta


def date_to_utc_instant(v: object, *, day_offset: int = 0) -> object:
    """Anchor a bare ``date`` to a UTC midnight instant; pass datetimes through.

    The sale window is a precise instant, so datetime inputs are returned
    unchanged. A bare ``date`` (e.g. from a CSV import) is anchored to UTC
    midnight, optionally shifted by ``day_offset`` days.
    """
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime.combine(v + timedelta(days=day_offset), time.min, tzinfo=UTC)
    return v
