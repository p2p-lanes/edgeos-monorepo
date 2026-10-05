"""Issuer policies: who besides admins may give which badges, and how many.

A policy lets an audience give a set of badges that share one allowance per
issuer (``allowance_quantity`` per ``allowance_window``). When several active
policies cover the same badge for the same person, the one with the most
allowance left is used, and the award records it so that later counts stay
per policy.
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, col, func, select

from app.api.badge import crud
from app.api.badge.models import (
    BadgeAwards,
    BadgeIssuerPolicies,
    BadgeIssuerPolicyBadges,
    Badges,
)
from app.api.badge.schemas import (
    AllowanceWindow,
    BadgeAudienceType,
    BadgeIssuerType,
    IssuableBadge,
)
from app.api.human.models import Humans


class BadgeForbiddenError(Exception):
    """The caller may not give this badge (no policy, self-award...)."""


class AllowanceExhaustedError(Exception):
    def __init__(self, resets_at: datetime | None) -> None:
        self.resets_at = resets_at
        super().__init__("No more of this badge to give for now")


def popup_timezone(db: Session, popup_id: uuid.UUID) -> ZoneInfo:
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, popup_id)
    try:
        return ZoneInfo(settings.timezone if settings else "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def window_bounds(
    window: AllowanceWindow, tz: ZoneInfo, now: datetime
) -> tuple[datetime | None, datetime | None]:
    """(start, resets_at) of the window containing ``now``, in UTC.

    Day and week boundaries are local midnights of ``tz`` (weeks start on
    Monday), so a DST change shortens or stretches that window rather than
    shifting it. ``popup`` and ``lifetime`` windows never reset.
    """
    if window not in (AllowanceWindow.DAY, AllowanceWindow.WEEK):
        return None, None
    local = now.astimezone(tz)
    start_date = local.date()
    length = 1
    if window == AllowanceWindow.WEEK:
        start_date -= timedelta(days=local.weekday())
        length = 7
    end_date = start_date + timedelta(days=length)
    start = datetime(start_date.year, start_date.month, start_date.day, tzinfo=tz)
    end = datetime(end_date.year, end_date.month, end_date.day, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def _used(
    db: Session,
    policy: BadgeIssuerPolicies,
    issuer_id: uuid.UUID,
    since: datetime | None,
) -> int:
    statement = select(func.count()).where(
        BadgeAwards.policy_id == policy.id,
        BadgeAwards.issuer_human_id == issuer_id,
        # An admin revoking a peer award gives the allowance back.
        col(BadgeAwards.revoked_at).is_(None),
    )
    if since is not None:
        statement = statement.where(BadgeAwards.awarded_at >= since)
    if policy.allowance_window == AllowanceWindow.POPUP:
        statement = statement.where(BadgeAwards.popup_id == policy.popup_id)
    return db.exec(statement).one()


def remaining(
    db: Session,
    policy: BadgeIssuerPolicies,
    issuer_id: uuid.UUID,
    tz: ZoneInfo,
    now: datetime,
) -> tuple[int | None, datetime | None]:
    """(how many more the issuer may give, when the allowance refills)."""
    if policy.allowance_quantity is None:
        return None, None
    start, resets_at = window_bounds(AllowanceWindow(policy.allowance_window), tz, now)
    left = max(policy.allowance_quantity - _used(db, policy, issuer_id, start), 0)
    return left, resets_at


def policies_for(
    db: Session,
    issuer_id: uuid.UUID,
    popup_id: uuid.UUID,
    badge_id: uuid.UUID | None = None,
) -> list[BadgeIssuerPolicies]:
    """Active policies whose audience includes the issuer in this popup."""
    from app.api.event_participant.crud import event_participants_crud

    statement = select(BadgeIssuerPolicies).where(
        col(BadgeIssuerPolicies.is_active).is_(True),
        (col(BadgeIssuerPolicies.popup_id).is_(None))
        | (BadgeIssuerPolicies.popup_id == popup_id),
    )
    if badge_id is not None:
        statement = statement.join(
            BadgeIssuerPolicyBadges,
            BadgeIssuerPolicyBadges.policy_id == BadgeIssuerPolicies.id,
        ).where(BadgeIssuerPolicyBadges.badge_id == badge_id)
    candidates = list(db.exec(statement).all())

    attendee: bool | None = None
    out = []
    for policy in candidates:
        audience = BadgeAudienceType(policy.audience_type)
        if audience == BadgeAudienceType.HUMANS:
            if any(h.id == issuer_id for h in policy.humans):
                out.append(policy)
        elif audience == BadgeAudienceType.POPUP_ATTENDEES:
            if attendee is None:
                eligibility = event_participants_crud.eligibility_by_human(
                    db, popup_id, {issuer_id}
                )
                attendee = eligibility[issuer_id].allowed
            if attendee:
                out.append(policy)
        else:
            out.append(policy)
    return out


def _better(
    a: tuple[int | None, datetime | None], b: tuple[int | None, datetime | None]
) -> bool:
    """Whether allowance ``a`` beats ``b`` (unlimited beats any number)."""
    if a[0] is None:
        return b[0] is not None
    return b[0] is not None and a[0] > b[0]


def issuable_badges(
    db: Session, issuer_id: uuid.UUID, popup_id: uuid.UUID
) -> list[IssuableBadge]:
    """Every badge the issuer may give in the popup, with its best allowance.

    Exhausted badges are listed too (remaining 0) so the portal can say when
    they come back instead of silently hiding them.
    """
    tz = popup_timezone(db, popup_id)
    now = datetime.now(UTC)
    resolver = crud.ImageResolver(crud.list_styles(db))
    best: dict[uuid.UUID, tuple[Badges, BadgeIssuerPolicies, tuple]] = {}
    for policy in policies_for(db, issuer_id, popup_id):
        allowance = remaining(db, policy, issuer_id, tz, now)
        for badge in policy.badges:
            if badge.archived_at is not None:
                continue
            current = best.get(badge.id)
            if current is None or _better(allowance, current[2]):
                best[badge.id] = (badge, policy, allowance)
    return sorted(
        (
            IssuableBadge(
                badge=crud.to_badge_summary(badge, resolver),
                policy_id=policy.id,
                allowance=policy.allowance_quantity,
                remaining=left,
                window=AllowanceWindow(policy.allowance_window),
                resets_at=resets_at,
            )
            for badge, policy, (left, resets_at) in best.values()
        ),
        key=lambda item: item.badge.name.lower(),
    )


def _display_name(human: Humans) -> str:
    return human.full_name or "Someone"


def award_as_human(
    db: Session,
    *,
    issuer_id: uuid.UUID,
    badge: Badges,
    recipient: Humans,
    popup_id: uuid.UUID,
    message: str | None,
) -> BadgeAwards:
    """Give ``badge`` from one human to another under the issuer's policies.

    Concurrency: the issuer's ``humans`` row is locked for the rest of the
    transaction, so two simultaneous sends from the same person are counted
    one after the other and can't both slip under the allowance.
    """
    if recipient.id == issuer_id:
        raise BadgeForbiddenError("You can't give yourself a badge")

    issuer = db.exec(
        select(Humans)
        .where(Humans.id == issuer_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()

    policies = policies_for(db, issuer_id, popup_id, badge.id)
    if not policies:
        db.rollback()
        raise BadgeForbiddenError("You can't give this badge")

    tz = popup_timezone(db, popup_id)
    now = datetime.now(UTC)
    chosen: BadgeIssuerPolicies | None = None
    chosen_allowance: tuple[int | None, datetime | None] | None = None
    soonest_reset: datetime | None = None
    for policy in policies:
        allowance = remaining(db, policy, issuer_id, tz, now)
        if allowance[0] == 0:
            if allowance[1] and (soonest_reset is None or allowance[1] < soonest_reset):
                soonest_reset = allowance[1]
            continue
        if chosen_allowance is None or _better(allowance, chosen_allowance):
            chosen, chosen_allowance = policy, allowance
    if chosen is None:
        db.rollback()
        raise AllowanceExhaustedError(soonest_reset)

    return crud.create_award(
        db,
        badge=badge,
        recipient=recipient,
        issuer_type=BadgeIssuerType.HUMAN,
        issuer_human_id=issuer.id,
        issuer_name=_display_name(issuer),
        popup_id=popup_id,
        policy_id=chosen.id,
        message=message,
    )
