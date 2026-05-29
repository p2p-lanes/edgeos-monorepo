"""Timezone-aware, locale-stable datetime formatting for event emails.

Event datetimes are stored as UTC instants. Email bodies must show the
*event's* local wall-clock time (e.g. ``Jun 07, 2026 at 18:00 PDT``), not
UTC, so we convert with the event's IANA ``timezone`` before formatting.
The ``.ics`` attachment stays UTC per RFC 5545 — only the human-readable
text is localized here.

``strftime`` codes ``%a``/``%b`` are locale-dependent (notably on Windows
hosts), so weekday/month names come from fixed English arrays to keep the
output identical across hosts.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

_PLACEHOLDER = "—"


def _to_local(dt: datetime, timezone: str | None) -> datetime:
    """Convert a UTC instant to the event's local tz.

    Naive datetimes are treated as UTC; unknown IANA names fall back to
    UTC so a bad ``timezone`` column never raises.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    try:
        tz = ZoneInfo(timezone or "UTC")
    except ZoneInfoNotFoundError:
        tz = UTC
    return dt.astimezone(tz)


def format_event_when(dt: datetime | None, timezone: str | None) -> str:
    """Render a single instant as ``"Jun 07, 2026 at 18:00 PDT"``.

    ``dt`` is a UTC instant; ``timezone`` an IANA name (e.g.
    ``America/Los_Angeles``). Returns ``"—"`` when ``dt`` is missing.
    """
    if not dt:
        return _PLACEHOLDER
    local = _to_local(dt, timezone)
    month = _MONTHS[local.month - 1]
    abbr = local.tzname() or ""
    base = f"{month} {local.day:02d}, {local.year} at {local.strftime('%H:%M')}"
    return f"{base} {abbr}".rstrip()


def format_event_when_range(
    start: datetime | None,
    end: datetime | None,
    timezone: str | None,
) -> str:
    """Render a start–end range in the event's local tz.

    Falls back to start-only when ``end`` is missing or equal to start.
    When both bounds land on the same local date, only the end time is
    shown after the dash (``"Jun 07, 2026 at 18:00 PDT – 19:00"``);
    otherwise the full ``"<start> – <end>"`` form is used. Both bounds are
    localized first so the range never mixes zones.
    """
    if not start:
        return _PLACEHOLDER
    start_str = format_event_when(start, timezone)
    if not end or end == start:
        return start_str
    local_start = _to_local(start, timezone)
    local_end = _to_local(end, timezone)
    if local_end.date() == local_start.date():
        return f"{start_str} – {local_end.strftime('%H:%M')}"
    return f"{start_str} – {format_event_when(end, timezone)}"
