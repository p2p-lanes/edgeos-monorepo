import uuid
from collections import defaultdict
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.api.badge.models import BadgeAwards, BadgeImages, Badges, BadgeStyles
from app.api.badge.schemas import (
    BadgeAwardPublic,
    BadgeAwardRecipient,
    BadgeImagePublic,
    BadgeIssuerType,
    BadgePublic,
    BadgeSummary,
    MyBadge,
    MyBadgeAward,
    PublicProfileBadge,
)
from app.api.human.models import Humans
from app.utils.utils import slugify


class BadgeConflictError(Exception):
    """A write would break a badge invariant (duplicate award, bad state...)."""


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------


def list_styles(db: Session) -> list[BadgeStyles]:
    return list(
        db.exec(
            select(BadgeStyles).order_by(
                col(BadgeStyles.sort_order), col(BadgeStyles.name)
            )
        ).all()
    )


def unique_style_key(db: Session, tenant_id: uuid.UUID, wanted: str) -> str:
    base = slugify(wanted) or "style"
    key, n = base, 2
    while db.exec(
        select(BadgeStyles.id).where(
            BadgeStyles.tenant_id == tenant_id, BadgeStyles.key == key
        )
    ).first():
        key, n = f"{base}-{n}", n + 1
    return key


def set_default_style(db: Session, style: BadgeStyles) -> None:
    """Make ``style`` the collection default. Does not commit."""
    others = db.exec(
        select(BadgeStyles).where(
            BadgeStyles.tenant_id == style.tenant_id,
            col(BadgeStyles.is_default).is_(True),
            BadgeStyles.id != style.id,
        )
    ).all()
    for other in others:
        other.is_default = False
        db.add(other)
    # Clear the old default before setting the new one: the partial unique
    # index allows a single default per tenant at any time.
    db.flush()
    style.is_default = True
    db.add(style)


# ---------------------------------------------------------------------------
# Badges
# ---------------------------------------------------------------------------


def unique_badge_slug(db: Session, tenant_id: uuid.UUID, wanted: str) -> str:
    base = slugify(wanted) or "badge"
    slug, n = base, 2
    while db.exec(
        select(Badges.id).where(Badges.tenant_id == tenant_id, Badges.slug == slug)
    ).first():
        slug, n = f"{base}-{n}", n + 1
    return slug


def list_badges(
    db: Session,
    *,
    include_archived: bool = False,
    search: str | None = None,
    category: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[Badges], int]:
    statement = select(Badges)
    if not include_archived:
        statement = statement.where(col(Badges.archived_at).is_(None))
    if search:
        statement = statement.where(col(Badges.name).ilike(f"%{search}%"))
    if category:
        statement = statement.where(Badges.category == category)
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    statement = (
        statement.order_by(col(Badges.category), col(Badges.name))
        .offset(skip)
        .limit(limit)
    )
    return list(db.exec(statement).all()), total


def get_badge(db: Session, badge_id: uuid.UUID) -> Badges | None:
    return db.get(Badges, badge_id)


def award_counts(db: Session, badge_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not badge_ids:
        return {}
    rows = db.exec(
        select(BadgeAwards.badge_id, func.count())
        .where(
            col(BadgeAwards.badge_id).in_(badge_ids),
            col(BadgeAwards.revoked_at).is_(None),
        )
        .group_by(col(BadgeAwards.badge_id))
    ).all()
    return dict(rows)


def has_any_award(db: Session, badge_id: uuid.UUID) -> bool:
    """Whether the badge was ever awarded, revoked awards included."""
    return (
        db.exec(
            select(BadgeAwards.id).where(BadgeAwards.badge_id == badge_id).limit(1)
        ).first()
        is not None
    )


class ImageResolver:
    """Picks a badge's artwork for the tenant's current style setup.

    Order: the badge's override style, then the collection default, then the
    first style (by sort order) the badge has an image for.
    """

    def __init__(self, styles: list[BadgeStyles]) -> None:
        self._order = {s.id: i for i, s in enumerate(styles)}
        self._default_id = next((s.id for s in styles if s.is_default), None)

    def resolve(self, badge: Badges) -> str | None:
        by_style = {img.style_id: img.image_url for img in badge.images}
        for style_id in (badge.style_override_id, self._default_id):
            if style_id and style_id in by_style:
                return by_style[style_id]
        ranked = sorted(
            badge.images, key=lambda img: self._order.get(img.style_id, 1_000_000)
        )
        return ranked[0].image_url if ranked else None


def to_badge_public(
    badge: Badges, resolver: ImageResolver, award_count: int = 0
) -> BadgePublic:
    return BadgePublic(
        id=badge.id,
        slug=badge.slug,
        name=badge.name,
        description=badge.description,
        category=badge.category,
        style_override_id=badge.style_override_id,
        repeatable=badge.repeatable,
        archived_at=badge.archived_at,
        created_at=badge.created_at,
        updated_at=badge.updated_at,
        images=[BadgeImagePublic.model_validate(img) for img in badge.images],
        image_url=resolver.resolve(badge),
        award_count=award_count,
    )


def to_badge_summary(badge: Badges, resolver: ImageResolver) -> BadgeSummary:
    return BadgeSummary(
        id=badge.id,
        slug=badge.slug,
        name=badge.name,
        description=badge.description,
        category=badge.category,
        repeatable=badge.repeatable,
        image_url=resolver.resolve(badge),
    )


def upsert_image(
    db: Session,
    badge: Badges,
    style_id: uuid.UUID,
    image_url: str,
    width: int | None = None,
    height: int | None = None,
) -> None:
    """Set the badge's artwork for one style. Does not commit."""
    existing = next((img for img in badge.images if img.style_id == style_id), None)
    if existing:
        existing.image_url = image_url
        existing.width = width
        existing.height = height
        db.add(existing)
        return
    badge.images.append(
        BadgeImages(
            tenant_id=badge.tenant_id,
            badge_id=badge.id,
            style_id=style_id,
            image_url=image_url,
            width=width,
            height=height,
        )
    )


def touch(badge: Badges) -> None:
    badge.updated_at = datetime.now(UTC)


# ---------------------------------------------------------------------------
# Awards
# ---------------------------------------------------------------------------


def find_human_by_email(db: Session, email: str) -> Humans | None:
    return db.exec(select(Humans).where(Humans.email == email.lower().strip())).first()


def create_award(
    db: Session,
    *,
    badge: Badges,
    recipient: Humans,
    issuer_type: BadgeIssuerType,
    issuer_user_id: uuid.UUID | None = None,
    issuer_human_id: uuid.UUID | None = None,
    issuer_name: str | None = None,
    popup_id: uuid.UUID | None = None,
    message: str | None = None,
) -> BadgeAwards:
    """Insert an award and commit.

    Raises ``BadgeConflictError`` when the badge is archived or when a
    non-repeatable badge is already active on the recipient (checked up front
    for a clear error, and by the partial unique index for races).
    """
    if badge.archived_at is not None:
        raise BadgeConflictError("This badge is archived")
    if not badge.repeatable and _has_active_award(db, badge.id, recipient.id):
        raise BadgeConflictError("This person already has this badge")

    award = BadgeAwards(
        tenant_id=badge.tenant_id,
        badge_id=badge.id,
        recipient_human_id=recipient.id,
        issuer_type=issuer_type.value,
        issuer_user_id=issuer_user_id,
        issuer_human_id=issuer_human_id,
        issuer_name=issuer_name,
        popup_id=popup_id,
        message=message or None,
        is_unique=not badge.repeatable,
    )
    db.add(award)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise BadgeConflictError("This person already has this badge") from exc
    db.refresh(award)
    return award


def _has_active_award(db: Session, badge_id: uuid.UUID, human_id: uuid.UUID) -> bool:
    return (
        db.exec(
            select(BadgeAwards.id).where(
                BadgeAwards.badge_id == badge_id,
                BadgeAwards.recipient_human_id == human_id,
                col(BadgeAwards.revoked_at).is_(None),
            )
        ).first()
        is not None
    )


def revoke_award(
    db: Session,
    award: BadgeAwards,
    *,
    revoked_by_user_id: uuid.UUID | None,
    reason: str | None,
) -> BadgeAwards:
    if award.revoked_at is not None:
        raise BadgeConflictError("This award is already revoked")
    award.revoked_at = datetime.now(UTC)
    award.revoked_by_user_id = revoked_by_user_id
    award.revoke_reason = reason or None
    db.add(award)
    db.commit()
    db.refresh(award)
    return award


def list_awards(
    db: Session,
    *,
    human_id: uuid.UUID | None = None,
    badge_id: uuid.UUID | None = None,
    include_revoked: bool = False,
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[BadgeAwards], int]:
    statement = select(BadgeAwards)
    if human_id:
        statement = statement.where(BadgeAwards.recipient_human_id == human_id)
    if badge_id:
        statement = statement.where(BadgeAwards.badge_id == badge_id)
    if not include_revoked:
        statement = statement.where(col(BadgeAwards.revoked_at).is_(None))
    total = db.exec(select(func.count()).select_from(statement.subquery())).one()
    statement = (
        statement.order_by(col(BadgeAwards.awarded_at).desc()).offset(skip).limit(limit)
    )
    return list(db.exec(statement).unique().all()), total


def to_award_public(
    db: Session, awards: list[BadgeAwards], resolver: ImageResolver
) -> list[BadgeAwardPublic]:
    recipient_ids = {a.recipient_human_id for a in awards}
    recipients = (
        {
            h.id: h
            for h in db.exec(
                select(Humans).where(col(Humans.id).in_(recipient_ids))
            ).all()
        }
        if recipient_ids
        else {}
    )
    out = []
    for award in awards:
        human = recipients.get(award.recipient_human_id)
        if human is None:
            continue
        out.append(
            BadgeAwardPublic(
                id=award.id,
                badge=to_badge_summary(award.badge, resolver),
                recipient=BadgeAwardRecipient(
                    id=human.id,
                    email=human.email,
                    first_name=human.first_name,
                    last_name=human.last_name,
                    picture_url=human.picture_url,
                ),
                issuer_type=BadgeIssuerType(award.issuer_type),
                issuer_name=award.issuer_name,
                popup_id=award.popup_id,
                message=award.message,
                awarded_at=award.awarded_at,
                revoked_at=award.revoked_at,
                revoke_reason=award.revoke_reason,
            )
        )
    return out


def _active_awards_of(db: Session, human_id: uuid.UUID) -> list[BadgeAwards]:
    return list(
        db.exec(
            select(BadgeAwards)
            .where(
                BadgeAwards.recipient_human_id == human_id,
                col(BadgeAwards.revoked_at).is_(None),
            )
            .order_by(col(BadgeAwards.awarded_at).desc())
        )
        .unique()
        .all()
    )


def my_badges(db: Session, human_id: uuid.UUID) -> list[MyBadge]:
    """The human's active awards grouped by badge, most recent first."""
    resolver = ImageResolver(list_styles(db))
    grouped: dict[uuid.UUID, list[BadgeAwards]] = defaultdict(list)
    for award in _active_awards_of(db, human_id):
        grouped[award.badge_id].append(award)
    return [
        MyBadge(
            badge=to_badge_summary(awards[0].badge, resolver),
            count=len(awards),
            last_awarded_at=awards[0].awarded_at,
            awards=[
                MyBadgeAward(
                    awarded_at=a.awarded_at, message=a.message, popup_id=a.popup_id
                )
                for a in awards
            ],
        )
        for awards in grouped.values()
    ]


def public_profile_badges(db: Session, human: Humans) -> list[PublicProfileBadge]:
    """Badges for the public share page: no messages, issuers or ids.

    Runs on an unscoped session, so every query filters by the human's tenant
    explicitly instead of relying on RLS.
    """
    styles = list(
        db.exec(
            select(BadgeStyles)
            .where(BadgeStyles.tenant_id == human.tenant_id)
            .order_by(col(BadgeStyles.sort_order), col(BadgeStyles.name))
        ).all()
    )
    resolver = ImageResolver(styles)
    awards = (
        db.exec(
            select(BadgeAwards)
            .where(
                BadgeAwards.tenant_id == human.tenant_id,
                BadgeAwards.recipient_human_id == human.id,
                col(BadgeAwards.revoked_at).is_(None),
            )
            .order_by(col(BadgeAwards.awarded_at).desc())
        )
        .unique()
        .all()
    )
    grouped: dict[uuid.UUID, list[BadgeAwards]] = defaultdict(list)
    for award in awards:
        grouped[award.badge_id].append(award)
    return [
        PublicProfileBadge(
            name=items[0].badge.name,
            description=items[0].badge.description,
            image_url=resolver.resolve(items[0].badge),
            count=len(items),
        )
        for items in grouped.values()
    ]
