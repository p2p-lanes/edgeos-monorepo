"""Automatic badge rules: badges earned by showing up or by hosting.

A rule is a list of conditions that must all hold (``BadgeRuleConfig``).
Each condition picks an activity (attending or hosting), filters the event
occurrences it looks at (popup, tracks, tags, kinds, venues, events,
weekdays, time of day, dates), and asks for a threshold of a measure over
them: occurrences, distinct days, or the longest streak of consecutive days.

Only settled occurrences count: an occurrence counts once its check-in
window has closed (``CHECK_IN_CLOSES_MINUTES_AFTER`` after it ends), because
until then a check-in can still be voided. Awards therefore come from the
sweep (``app/jobs/badge_rules_sweep.py``, run every 15 minutes) and from the
per-rule evaluate endpoint, never from the check-in request itself.

Each rule awards a person at most once, ever (a partial unique index): if
an admin revokes it, the rule does not hand it back.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import bindparam, or_, text
from sqlmodel import Session, col, func, select

from app.api.badge import crud
from app.api.badge.models import BadgeAwards, BadgeRules
from app.api.badge.policies import popup_timezone
from app.api.badge.schemas import (
    BadgeIssuerType,
    BadgeRuleCondition,
    BadgeRuleConfig,
    BadgeRuleFilters,
    RuleActivity,
    RuleMeasure,
    TagsMatch,
)
from app.api.human.models import Humans

RULE_ISSUER_NAME = "Automatic"
RULE_CONFIG_TYPE = "conditions"


def parse_config(rule: BadgeRules) -> BadgeRuleConfig:
    return BadgeRuleConfig.model_validate(rule.config)


def _settle_delay() -> timedelta:
    from app.api.event_participant.check_in import CHECK_IN_CLOSES_MINUTES_AFTER

    return timedelta(minutes=CHECK_IN_CLOSES_MINUTES_AFTER)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@dataclass(frozen=True)
class _Occurrence:
    human_id: uuid.UUID
    event_id: uuid.UUID
    popup_id: uuid.UUID
    start: datetime


# ---------------------------------------------------------------------------
# Collecting occurrences
# ---------------------------------------------------------------------------


def _event_filters(statement, filters: BadgeRuleFilters):
    """Narrow a statement joined to ``Events`` by the event-level filters."""
    from app.api.event.models import Events

    if filters.popup_id is not None:
        statement = statement.where(Events.popup_id == filters.popup_id)
    if filters.track_ids:
        statement = statement.where(col(Events.track_id).in_(filters.track_ids))
    if filters.venue_ids:
        statement = statement.where(col(Events.venue_id).in_(filters.venue_ids))
    if filters.event_ids:
        statement = statement.where(col(Events.id).in_(filters.event_ids))
    if filters.kinds:
        statement = statement.where(
            func.lower(func.btrim(Events.kind)).in_(
                [kind.casefold() for kind in filters.kinds]
            )
        )
    if filters.tags:
        tags = [tag.casefold() for tag in filters.tags]
        has_tag = (
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(events.tags) AS t(tag)"
            " WHERE lower(btrim(t.tag)) {match})"
        )
        if filters.tags_match == TagsMatch.ANY:
            statement = statement.where(
                text(has_tag.format(match="IN :rule_tags")).bindparams(
                    bindparam("rule_tags", value=tags, expanding=True)
                )
            )
        else:
            for index, tag in enumerate(tags):
                name = f"rule_tag_{index}"
                statement = statement.where(
                    text(has_tag.format(match=f"= :{name}")).bindparams(
                        bindparam(name, value=tag)
                    )
                )
    return statement


def _attended(
    db: Session,
    tenant_id: uuid.UUID,
    filters: BadgeRuleFilters,
    human_ids: set[uuid.UUID] | None,
) -> Iterable[tuple[_Occurrence, timedelta]]:
    """Non-voided check-ins, one per (person, event, occurrence)."""
    from app.api.event.models import Events
    from app.api.event_participant.models import EventCheckIns

    statement = (
        select(
            EventCheckIns.profile_id,
            EventCheckIns.event_id,
            EventCheckIns.occurrence_start,
            Events.popup_id,
            Events.start_time,
            Events.end_time,
        )
        .join(Events, col(Events.id) == EventCheckIns.event_id)
        .where(
            EventCheckIns.tenant_id == tenant_id,
            col(EventCheckIns.voided_at).is_(None),
        )
        .distinct()
    )
    if human_ids is not None:
        statement = statement.where(col(EventCheckIns.profile_id).in_(human_ids))
    statement = _event_filters(statement, filters)
    for human_id, event_id, occurrence, popup_id, start, end in db.exec(statement):
        duration = _aware(end) - _aware(start)
        occ_start = _aware(occurrence or start)
        yield _Occurrence(human_id, event_id, popup_id, occ_start), duration


def _hosted(
    db: Session,
    tenant_id: uuid.UUID,
    filters: BadgeRuleFilters,
    human_ids: set[uuid.UUID] | None,
    until: datetime,
) -> Iterable[tuple[_Occurrence, timedelta]]:
    """Occurrences of published events the person organized or spoke at.

    Organizers are the event's owner, its designated host and its
    collaborators, plus participants with the host or speaker role. Anyone
    tied to a whole series hosts every occurrence (expanded up to ``until``);
    a host signed up for one occurrence hosts just that one.
    """
    from app.api.event.models import Events
    from app.api.event.recurrence import expand, parse_rrule
    from app.api.event.schemas import EventStatus
    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantRole, ParticipantStatus

    published = [Events.tenant_id == tenant_id, Events.status == EventStatus.PUBLISHED]
    organized = _event_filters(select(Events).where(*published), filters)
    speakers = _event_filters(
        select(EventParticipants.profile_id, Events, EventParticipants.occurrence_start)
        .join(Events, col(Events.id) == EventParticipants.event_id)
        .where(
            *published,
            col(EventParticipants.role).in_(
                [ParticipantRole.HOST, ParticipantRole.SPEAKER]
            ),
            EventParticipants.status != ParticipantStatus.CANCELLED,
        ),
        filters,
    )
    if human_ids is not None:
        ids = list(human_ids)
        organized = organized.where(
            or_(
                col(Events.owner_id).in_(ids),
                col(Events.host_id).in_(ids),
                col(Events.collaborator_ids).overlap(ids),
            )
        )
        speakers = speakers.where(col(EventParticipants.profile_id).in_(ids))

    rows: list[tuple[uuid.UUID, Events, datetime | None]] = []
    for event in db.exec(organized):
        people = {event.owner_id, event.host_id, *event.collaborator_ids}
        for human_id in people - {None}:
            if human_ids is None or human_id in human_ids:
                rows.append((human_id, event, None))
    rows.extend(db.exec(speakers))

    seen: set[tuple[uuid.UUID, uuid.UUID, datetime]] = set()
    for human_id, event, occurrence in rows:
        start, end = _aware(event.start_time), _aware(event.end_time)
        duration = end - start
        rule = parse_rrule(event.rrule) if event.rrule else None
        if occurrence is not None or rule is None or event.recurrence_master_id:
            starts = [_aware(occurrence) if occurrence else start]
        else:
            starts = [
                _aware(s)
                for s in expand(
                    dtstart=start,
                    rule=rule,
                    window_end=until - duration,
                    exdates=event.recurrence_exdates,
                    timezone=event.timezone,
                )
            ]
        for occ_start in starts:
            key = (human_id, event.id, occ_start)
            if key in seen:
                continue
            seen.add(key)
            yield _Occurrence(human_id, event.id, event.popup_id, occ_start), duration


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------


class _Zones:
    """Popup timezones, looked up once per evaluation."""

    def __init__(self, db: Session):
        self._db = db
        self._cache: dict[uuid.UUID, ZoneInfo] = {}

    def __call__(self, popup_id: uuid.UUID) -> ZoneInfo:
        if popup_id not in self._cache:
            self._cache[popup_id] = popup_timezone(self._db, popup_id)
        return self._cache[popup_id]


def _matches_time(filters: BadgeRuleFilters, local: datetime) -> bool:
    if filters.weekdays and local.isoweekday() not in filters.weekdays:
        return False
    moment = local.time().replace(tzinfo=None)
    if filters.starts_after is not None and moment < filters.starts_after:
        return False
    if filters.starts_before is not None and moment >= filters.starts_before:
        return False
    if filters.date_from is not None and local.date() < filters.date_from:
        return False
    if filters.date_to is not None and local.date() > filters.date_to:
        return False
    return True


def longest_streak(days: set[date]) -> int:
    best = run = 0
    previous: date | None = None
    for day in sorted(days):
        run = run + 1 if previous and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    return best


def _measure(measure: RuleMeasure, keys: set, days: set[date]) -> int:
    if measure == RuleMeasure.COUNT:
        return len(keys)
    if measure == RuleMeasure.DISTINCT_DAYS:
        return len(days)
    return longest_streak(days)


def _qualified_for_condition(
    db: Session,
    tenant_id: uuid.UUID,
    condition: BadgeRuleCondition,
    human_ids: set[uuid.UUID] | None,
    now: datetime,
    zones: _Zones,
) -> set[uuid.UUID]:
    filters = condition.filters
    settle = _settle_delay()
    if condition.activity == RuleActivity.ATTEND:
        rows = _attended(db, tenant_id, filters, human_ids)
    else:
        rows = _hosted(db, tenant_id, filters, human_ids, until=now - settle)

    keys: dict[uuid.UUID, set] = defaultdict(set)
    days: dict[uuid.UUID, set[date]] = defaultdict(set)
    for occurrence, duration in rows:
        if occurrence.start + duration + settle > now:
            continue  # still voidable (or hasn't happened yet)
        local = occurrence.start.astimezone(zones(occurrence.popup_id))
        if not _matches_time(filters, local):
            continue
        keys[occurrence.human_id].add((occurrence.event_id, occurrence.start))
        days[occurrence.human_id].add(local.date())
    return {
        human_id
        for human_id in keys
        if _measure(condition.measure, keys[human_id], days[human_id])
        >= condition.threshold
    }


def qualified_humans(
    db: Session,
    tenant_id: uuid.UUID,
    config: BadgeRuleConfig,
    human_ids: set[uuid.UUID] | None = None,
    now: datetime | None = None,
) -> set[uuid.UUID]:
    """Humans of the tenant who meet every condition of ``config``."""
    if human_ids is not None and not human_ids:
        return set()
    now = now or datetime.now(UTC)
    zones = _Zones(db)
    qualified: set[uuid.UUID] | None = human_ids
    for condition in config.conditions:
        qualified = _qualified_for_condition(
            db, tenant_id, condition, qualified, now, zones
        )
        if not qualified:
            return set()
    # Event owners can be admin users; only humans earn badges.
    return set(
        db.exec(
            select(Humans.id).where(
                col(Humans.id).in_(qualified or set()), Humans.tenant_id == tenant_id
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# Awarding
# ---------------------------------------------------------------------------


def evaluate_rule(
    db: Session,
    rule: BadgeRules,
    human_ids: set[uuid.UUID] | None = None,
    now: datetime | None = None,
) -> int:
    """Award the rule's badge to everyone (or ``human_ids``) who qualifies.

    Idempotent: people the rule already awarded, and people who already hold
    a non-repeatable badge, are skipped. Returns how many awards were made.
    """
    badge = rule.badge
    if not rule.is_active or badge.archived_at is not None:
        return 0
    candidates = qualified_humans(
        db, rule.tenant_id, parse_config(rule), human_ids, now
    )
    if not candidates:
        return 0
    already = set(
        db.exec(
            select(BadgeAwards.recipient_human_id).where(BadgeAwards.rule_id == rule.id)
        ).all()
    )
    pending = candidates - already
    if not pending:
        return 0
    humans = db.exec(
        select(Humans).where(
            col(Humans.id).in_(pending), Humans.tenant_id == rule.tenant_id
        )
    ).all()
    awarded = 0
    for human in humans:
        try:
            crud.create_award(
                db,
                badge=badge,
                recipient=human,
                issuer_type=BadgeIssuerType.RULE,
                issuer_name=RULE_ISSUER_NAME,
                rule_id=rule.id,
            )
            awarded += 1
        except crud.BadgeConflictError:
            # Holds the (non-repeatable) badge already, or a concurrent
            # evaluation got there first.
            continue
    return awarded


def preview(
    db: Session, tenant_id: uuid.UUID, badge, config: BadgeRuleConfig
) -> tuple[int, int]:
    """(people who meet ``config`` now, of those who'd get the badge)."""
    qualified = qualified_humans(db, tenant_id, config)
    if not qualified:
        return 0, 0
    held = set()
    if not badge.repeatable:
        held = set(
            db.exec(
                select(BadgeAwards.recipient_human_id).where(
                    BadgeAwards.badge_id == badge.id,
                    col(BadgeAwards.recipient_human_id).in_(qualified),
                    col(BadgeAwards.revoked_at).is_(None),
                )
            ).all()
        )
    return len(qualified), len(qualified - held)


def sweep_badge_rules(db: Session, now: datetime | None = None) -> dict:
    """Evaluate every active rule of every tenant (main, unscoped session)."""
    summary = {"rules": 0, "awarded": 0, "failures": 0}
    rules = db.exec(select(BadgeRules).where(col(BadgeRules.is_active).is_(True))).all()
    for rule in rules:
        summary["rules"] += 1
        try:
            summary["awarded"] += evaluate_rule(db, rule, now=now)
        except Exception:
            db.rollback()
            summary["failures"] += 1
            logger.exception("Badge rule {} failed during the sweep", rule.id)
    return summary
