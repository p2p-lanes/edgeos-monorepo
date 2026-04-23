"""Pure recurrence helpers for the events module.

Implements a small RFC-5545 subset used by the UI:

- ``FREQ=DAILY|WEEKLY|MONTHLY``
- ``INTERVAL`` (default 1)
- ``BYDAY=MO,TU,...`` (only with ``FREQ=WEEKLY``)
- ``COUNT`` OR ``UNTIL`` (mutually exclusive)
- ``EXDATE`` is stored separately (on the event row, as JSON list) — not
  embedded in the RRULE string.

Example canonical strings::

    FREQ=DAILY;INTERVAL=1;COUNT=5
    FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=10
    FREQ=MONTHLY;INTERVAL=1;UNTIL=20260801T000000Z

The helpers below are deterministic and time-zone neutral: they operate on
``datetime`` objects and preserve tzinfo (including ``None``).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from app.api.event.schemas import RecurrenceRule

if TYPE_CHECKING:
    pass


WEEKDAY_CODES: tuple[str, ...] = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
# Map MO..SU -> 0..6 (Python's datetime.weekday())
WEEKDAY_INDEX: dict[str, int] = {code: i for i, code in enumerate(WEEKDAY_CODES)}

# Default safety cap on expansion, to avoid runaway loops.
DEFAULT_MAX_OCCURRENCES = 100
# Hard ceiling regardless of caller settings.
HARD_MAX_OCCURRENCES = 1000


# ---------------------------------------------------------------------------
# Parsing / formatting
# ---------------------------------------------------------------------------


def format_rrule(rule: RecurrenceRule) -> str:
    """Serialize a ``RecurrenceRule`` to a canonical RRULE string."""
    parts: list[str] = [f"FREQ={rule.freq}"]
    parts.append(f"INTERVAL={rule.interval}")
    if rule.by_day:
        parts.append("BYDAY=" + ",".join(rule.by_day))
    if rule.count is not None:
        parts.append(f"COUNT={rule.count}")
    elif rule.until is not None:
        # Always serialize UNTIL in UTC Zulu form.
        until = rule.until
        if until.tzinfo is not None:
            # Convert to naive UTC for serialization.
            import datetime as _dt

            until = until.astimezone(_dt.UTC).replace(tzinfo=None)
        parts.append("UNTIL=" + until.strftime("%Y%m%dT%H%M%SZ"))
    return ";".join(parts)


def parse_rrule(s: str | None) -> RecurrenceRule | None:
    """Parse a canonical RRULE string back into a ``RecurrenceRule``.

    Returns ``None`` for empty / falsy input. Raises ``ValueError`` for
    malformed strings.
    """
    if not s:
        return None
    raw = s.strip()
    if raw.upper().startswith("RRULE:"):
        raw = raw[len("RRULE:"):]

    kv: dict[str, str] = {}
    for part in raw.split(";"):
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"Malformed RRULE segment: {part!r}")
        key, value = part.split("=", 1)
        kv[key.strip().upper()] = value.strip()

    freq = kv.get("FREQ")
    if freq not in {"DAILY", "WEEKLY", "MONTHLY"}:
        raise ValueError(f"Unsupported FREQ: {freq!r}")

    interval_raw = kv.get("INTERVAL", "1")
    try:
        interval = int(interval_raw)
    except ValueError as exc:
        raise ValueError(f"Bad INTERVAL: {interval_raw!r}") from exc

    by_day: list[str] | None = None
    if "BYDAY" in kv:
        codes = [c.strip().upper() for c in kv["BYDAY"].split(",") if c.strip()]
        for c in codes:
            if c not in WEEKDAY_INDEX:
                raise ValueError(f"Bad BYDAY code: {c!r}")
        by_day = codes or None

    count: int | None = None
    until: datetime | None = None
    if "COUNT" in kv and "UNTIL" in kv:
        raise ValueError("RRULE cannot specify both COUNT and UNTIL")
    if "COUNT" in kv:
        count = int(kv["COUNT"])
    elif "UNTIL" in kv:
        until = _parse_rrule_datetime(kv["UNTIL"])

    return RecurrenceRule(
        freq=freq,  # type: ignore[arg-type]
        interval=interval,
        by_day=by_day,  # type: ignore[arg-type]
        count=count,
        until=until,
    )


def _parse_rrule_datetime(raw: str) -> datetime:
    """Parse a RRULE ``UNTIL`` datetime (``YYYYMMDDTHHMMSSZ``)."""
    r = raw.strip()
    if r.endswith("Z"):
        r = r[:-1]
    # Two forms accepted: date-only and full datetime.
    if "T" in r:
        return datetime.strptime(r, "%Y%m%dT%H%M%S")
    return datetime.strptime(r, "%Y%m%d")


# ---------------------------------------------------------------------------
# Expansion
# ---------------------------------------------------------------------------


def _increment(start: datetime, rule: RecurrenceRule, n: int) -> datetime:
    """Return ``start`` advanced ``n`` periods per the rule.

    For ``MONTHLY`` we advance by calendar months preserving day-of-month
    where possible (if the target month is shorter we clamp to its last day,
    matching typical consumer-calendar behaviour).
    """
    if rule.freq == "DAILY":
        return start + timedelta(days=rule.interval * n)
    if rule.freq == "WEEKLY":
        return start + timedelta(weeks=rule.interval * n)
    if rule.freq == "MONTHLY":
        return _add_months(start, rule.interval * n)
    raise ValueError(f"Unsupported freq: {rule.freq}")


def _add_months(dt: datetime, months: int) -> datetime:
    total = dt.month - 1 + months
    new_year = dt.year + total // 12
    new_month = total % 12 + 1
    # Clamp day-of-month to the target month's length.
    day = min(dt.day, _month_length(new_year, new_month))
    return dt.replace(year=new_year, month=new_month, day=day)


def _month_length(year: int, month: int) -> int:
    if month == 12:
        next_month_first = datetime(year + 1, 1, 1)
    else:
        next_month_first = datetime(year, month + 1, 1)
    return (next_month_first - timedelta(days=1)).day


def _normalize_exdate(raw: str | datetime) -> datetime | None:
    """Best-effort parse of an ISO8601 datetime string stored in EXDATE."""
    if isinstance(raw, datetime):
        return _as_naive_utc(raw)
    try:
        # ``fromisoformat`` handles 'YYYY-MM-DDTHH:MM:SS[+HH:MM|Z]' in 3.11+.
        s = raw.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        parsed = datetime.fromisoformat(s)
        return _as_naive_utc(parsed)
    except Exception:
        return None


def _as_naive_utc(dt: datetime) -> datetime:
    """Return an offset-naive UTC datetime (strip tzinfo after converting)."""
    if dt.tzinfo is None:
        return dt
    import datetime as _dt

    return dt.astimezone(_dt.UTC).replace(tzinfo=None)


def expand(
    *,
    dtstart: datetime,
    rule: RecurrenceRule,
    window_start: datetime | None = None,
    window_end: datetime | None = None,
    exdates: list[str | datetime] | None = None,
    max_occurrences: int = DEFAULT_MAX_OCCURRENCES,
) -> list[datetime]:
    """Expand ``rule`` starting at ``dtstart`` and return occurrence datetimes.

    Only datetimes that fall within ``[window_start, window_end]`` are
    emitted; the window may be half-open (``None`` = unbounded on that side).

    Results are deterministic, time-zone preserving (we keep the caller's
    tzinfo on ``dtstart`` untouched — EXDATE matching normalizes to UTC for
    comparison only).

    Safety: the loop is hard-capped at ``HARD_MAX_OCCURRENCES`` regardless of
    arguments. Caller may lower the cap via ``max_occurrences``.
    """
    cap = max(1, min(max_occurrences, HARD_MAX_OCCURRENCES))

    # Build EXDATE set once, normalized.
    exdate_set: set[datetime] = set()
    for raw in exdates or []:
        norm = _normalize_exdate(raw)
        if norm is not None:
            exdate_set.add(norm)

    # WEEKLY + BYDAY: iterate weeks, emit each matching weekday within the
    # same week block (week starts on the weekday of dtstart).
    if rule.freq == "WEEKLY" and rule.by_day:
        target_weekdays = sorted({WEEKDAY_INDEX[c] for c in rule.by_day})
    else:
        target_weekdays = None

    results: list[datetime] = []
    # ``produced_total`` counts every RFC-visible occurrence (including
    # EXDATE-skipped and pre-window ones) so COUNT semantics stay correct.
    # ``cap`` is a ceiling on the *emitted* list — checked via ``len(results)``
    # — so a series whose dtstart precedes ``window_start`` still reaches the
    # window instead of running out of cap on pre-window iterations.
    produced_total = 0
    n = 0  # period counter
    # Hard ceiling on period iterations, independent of ``cap``. Lets us walk
    # from a far-past dtstart to the window without bailing early.
    max_iters = HARD_MAX_OCCURRENCES * 10

    until_naive = _as_naive_utc(rule.until) if rule.until else None

    while len(results) < cap:
        if n > max_iters:
            return results
        base = _increment(dtstart, rule, n)

        candidates: list[datetime] = []
        if target_weekdays is not None:
            # Expand each weekday in the current week block.
            base_weekday = dtstart.weekday()
            for wd in target_weekdays:
                delta_days = (wd - base_weekday) % 7
                candidates.append(base + timedelta(days=delta_days))
        else:
            candidates.append(base)

        for cand in candidates:
            cand_naive = _as_naive_utc(cand)
            # Skip candidates that fall before dtstart (can happen for BYDAY
            # in the first iteration when the first target weekday precedes
            # dtstart's weekday — we computed (wd - base_weekday) % 7 which
            # is >= 0, so this is only a safety guard). Not counted toward
            # COUNT.
            if _as_naive_utc(cand) < _as_naive_utc(dtstart):
                continue
            # COUNT cap
            if rule.count is not None and produced_total >= rule.count:
                return results
            # UNTIL cap
            if until_naive is not None and cand_naive > until_naive:
                return results

            # This candidate counts toward COUNT (per RFC) even if we then
            # skip it via EXDATE or the window filter.
            produced_total += 1

            # EXDATE skip
            if cand_naive in exdate_set:
                continue
            # Window filter.
            if window_start is not None and cand_naive < _as_naive_utc(window_start):
                continue
            if window_end is not None and cand_naive > _as_naive_utc(window_end):
                return results

            results.append(cand)
            if len(results) >= cap:
                return results

        n += 1

    return results


# ---------------------------------------------------------------------------
# Convenience helpers tying a series master Events row to expansion.
# ---------------------------------------------------------------------------


def synthetic_occurrence_id(master_id, occurrence_start: datetime) -> str:
    """Build the synthetic id used for expanded occurrences."""
    ts = _as_naive_utc(occurrence_start).strftime("%Y%m%dT%H%M%S")
    return f"{master_id}_{ts}"


def parse_occurrence_id(s: str) -> tuple[str, datetime] | None:
    """Reverse of :func:`synthetic_occurrence_id`.

    Returns ``(master_id_str, occurrence_start_utc_naive)`` or ``None`` when
    the string does not match the pattern.
    """
    if not s or "_" not in s:
        return None
    master, _, stamp = s.rpartition("_")
    try:
        dt = datetime.strptime(stamp, "%Y%m%dT%H%M%S")
    except ValueError:
        return None
    return master, dt
