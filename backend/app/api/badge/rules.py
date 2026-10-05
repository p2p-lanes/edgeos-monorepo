"""Automatic badge rules: badges earned by showing up.

A rule counts a person's attendance (non-voided check-ins, at most one per
event occurrence) and gives its badge once they reach the threshold. Each
rule awards a person at most once, ever (enforced by a partial unique
index): if an admin revokes it, the next check-in does not hand it back.

Two triggers keep awards current:

* right after a check-in, only for the rules that event can affect;
* a sweep (``app/jobs/badge_rules_sweep.py`` and the per-rule evaluate
  endpoint) that catches anything missed, and historical check-ins when a
  rule is created.

Voiding a check-in never revokes an award already given.
"""

import uuid

from loguru import logger
from pydantic import TypeAdapter
from sqlmodel import Session, col, func, select

from app.api.badge import crud
from app.api.badge.models import BadgeAwards, BadgeRules
from app.api.badge.schemas import (
    BadgeIssuerType,
    BadgeRuleConfig,
    CheckinsInPopupConfig,
    CheckinsInTrackConfig,
)
from app.api.human.models import Humans

_config_adapter: TypeAdapter[BadgeRuleConfig] = TypeAdapter(BadgeRuleConfig)

RULE_ISSUER_NAME = "Automatic"


def parse_config(rule: BadgeRules) -> BadgeRuleConfig:
    return _config_adapter.validate_python(rule.config)


def _occurrences(
    tenant_id: uuid.UUID,
    config: BadgeRuleConfig,
    human_ids: set[uuid.UUID] | None,
):
    """Distinct (person, event, occurrence) attendance rows the rule counts."""
    from app.api.event.models import Events
    from app.api.event_participant.models import EventCheckIns

    statement = (
        select(
            EventCheckIns.profile_id,
            EventCheckIns.event_id,
            EventCheckIns.occurrence_start,
        )
        .join(Events, col(Events.id) == EventCheckIns.event_id)
        .where(
            EventCheckIns.tenant_id == tenant_id,
            col(EventCheckIns.voided_at).is_(None),
        )
    )
    if human_ids is not None:
        statement = statement.where(col(EventCheckIns.profile_id).in_(human_ids))
    if isinstance(config, CheckinsInTrackConfig):
        statement = statement.where(Events.track_id == config.track_id)
    elif isinstance(config, CheckinsInPopupConfig):
        statement = statement.where(Events.popup_id == config.popup_id)
    return statement.distinct()


def qualified_humans(
    db: Session, rule: BadgeRules, human_ids: set[uuid.UUID] | None = None
) -> set[uuid.UUID]:
    """People whose attendance meets the rule's threshold."""
    if human_ids is not None and not human_ids:
        return set()
    config = parse_config(rule)
    sub = _occurrences(rule.tenant_id, config, human_ids).subquery()
    rows = db.exec(
        select(sub.c.profile_id)
        .group_by(sub.c.profile_id)
        .having(func.count() >= config.threshold)
    ).all()
    return set(rows)


def evaluate_rule(
    db: Session, rule: BadgeRules, human_ids: set[uuid.UUID] | None = None
) -> int:
    """Award the rule's badge to everyone (or ``human_ids``) who qualifies.

    Idempotent: people the rule already awarded, and people who already hold
    a non-repeatable badge, are skipped. Returns how many awards were made.
    """
    badge = rule.badge
    if not rule.is_active or badge.archived_at is not None:
        return 0
    candidates = qualified_humans(db, rule, human_ids)
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


def _affects(config: BadgeRuleConfig, event) -> bool:
    if isinstance(config, CheckinsInTrackConfig):
        return event.track_id is not None and event.track_id == config.track_id
    if isinstance(config, CheckinsInPopupConfig):
        return event.popup_id == config.popup_id
    return False


def evaluate_after_check_in(db: Session, human_id: uuid.UUID, event) -> None:
    """Hook for a fresh check-in: run the rules this event can move.

    Called after the check-in is committed. Never raises: a rule problem is
    logged and the sweep retries later, so a check-in can't fail over a badge.
    """
    try:
        rules = db.exec(
            select(BadgeRules).where(
                BadgeRules.tenant_id == event.tenant_id,
                col(BadgeRules.is_active).is_(True),
            )
        ).all()
        for rule in rules:
            if _affects(parse_config(rule), event):
                evaluate_rule(db, rule, {human_id})
    except Exception:
        db.rollback()
        logger.exception(
            "Badge rule evaluation failed after check-in (human={}, event={})",
            human_id,
            event.id,
        )


def sweep_badge_rules(db: Session) -> dict:
    """Evaluate every active rule of every tenant (main, unscoped session)."""
    summary = {"rules": 0, "awarded": 0, "failures": 0}
    rules = db.exec(select(BadgeRules).where(col(BadgeRules.is_active).is_(True))).all()
    for rule in rules:
        summary["rules"] += 1
        try:
            summary["awarded"] += evaluate_rule(db, rule)
        except Exception:
            db.rollback()
            summary["failures"] += 1
            logger.exception("Badge rule {} failed during the sweep", rule.id)
    return summary
