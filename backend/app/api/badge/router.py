import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from loguru import logger
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.api.badge import crud, policies, rules
from app.api.badge.models import (
    BadgeAwards,
    BadgeImages,
    BadgeIssuerPolicies,
    BadgeRules,
    Badges,
    BadgeStyles,
)
from app.api.badge.schemas import (
    AllowanceWindow,
    BadgeAudienceType,
    BadgeAwardCreate,
    BadgeAwardPublic,
    BadgeAwardRecipient,
    BadgeAwardRevoke,
    BadgeBulkAwardCreate,
    BadgeBulkAwardResult,
    BadgeCreate,
    BadgeImageUpsert,
    BadgeIssuerPolicyCreate,
    BadgeIssuerPolicyHuman,
    BadgeIssuerPolicyPublic,
    BadgeIssuerPolicyUpdate,
    BadgeIssuerType,
    BadgePublic,
    BadgeRuleConfig,
    BadgeRuleCreate,
    BadgeRuleEvaluation,
    BadgeRuleOptions,
    BadgeRulePreview,
    BadgeRulePreviewRequest,
    BadgeRulePublic,
    BadgeRuleUpdate,
    BadgeStyleCreate,
    BadgeStylePublic,
    BadgeStyleUpdate,
    BadgeUpdate,
    IssuableBadge,
    MyBadge,
    PortalBadgeAwardCreate,
    SentBadgeAward,
)
from app.api.human.models import Humans
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import (
    AdminOrApiKey_BadgesRead,
    AdminOrApiKey_BadgesWrite,
    AdminOrApiKeySession_BadgesRead,
    AdminOrApiKeySession_BadgesWrite,
    CurrentHuman,
    HumanTenantSession,
    needs,
)

router = APIRouter(prefix="/badges", tags=["badges"])
styles_router = APIRouter(prefix="/badge-styles", tags=["badges"])
policies_router = APIRouter(prefix="/badge-issuer-policies", tags=["badges"])
rules_router = APIRouter(prefix="/badge-rules", tags=["badges"])

_XTenantId = Annotated[str | None, Header(alias="X-Tenant-Id")]


def _not_found(what: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found"
    )


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _tenant_id(current_user, x_tenant_id: str | None) -> uuid.UUID:
    """Own tenant for admins and API keys, X-Tenant-Id for a superadmin."""
    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Tenant-Id header required for superadmin access",
            )
        try:
            return uuid.UUID(x_tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            )
    if not current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="User has no tenant assigned"
        )
    return current_user.tenant_id


def _get_style_or_404(db: Session, style_id: uuid.UUID) -> BadgeStyles:
    style = db.get(BadgeStyles, style_id)
    if not style:
        raise _not_found("Badge style")
    return style


def _get_badge_or_404(db: Session, badge_id: uuid.UUID) -> Badges:
    badge = crud.get_badge(db, badge_id)
    if not badge:
        raise _not_found("Badge")
    return badge


def _badge_public(db: Session, badge: Badges) -> BadgePublic:
    resolver = crud.ImageResolver(crud.list_styles(db))
    count = crud.award_counts(db, [badge.id]).get(badge.id, 0)
    return crud.to_badge_public(badge, resolver, count)


# ---------------------------------------------------------------------------
# Styles (image sets of the collection)
# ---------------------------------------------------------------------------


@styles_router.get("", response_model=list[BadgeStylePublic])
async def list_badge_styles(
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
) -> list[BadgeStylePublic]:
    return [BadgeStylePublic.model_validate(s) for s in crud.list_styles(db)]


@styles_router.post(
    "", response_model=BadgeStylePublic, status_code=status.HTTP_201_CREATED
)
async def create_badge_style(
    style_in: BadgeStyleCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
    x_tenant_id: _XTenantId = None,
) -> BadgeStylePublic:
    tenant_id = _tenant_id(current_user, x_tenant_id)
    key = crud.unique_style_key(db, tenant_id, style_in.key or style_in.name)
    style = BadgeStyles(
        tenant_id=tenant_id,
        key=key,
        name=style_in.name,
        sort_order=style_in.sort_order,
    )
    db.add(style)
    db.flush()
    # The first style of a collection becomes its default.
    if not any(s.is_default for s in crud.list_styles(db)):
        crud.set_default_style(db, style)
    db.commit()
    db.refresh(style)
    return BadgeStylePublic.model_validate(style)


@styles_router.patch("/{style_id}", response_model=BadgeStylePublic)
async def update_badge_style(
    style_id: uuid.UUID,
    style_in: BadgeStyleUpdate,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgeStylePublic:
    style = _get_style_or_404(db, style_id)
    for field, value in style_in.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(style, field, value)
    db.add(style)
    db.commit()
    db.refresh(style)
    return BadgeStylePublic.model_validate(style)


@styles_router.post("/{style_id}/default", response_model=BadgeStylePublic)
async def set_default_badge_style(
    style_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgeStylePublic:
    style = _get_style_or_404(db, style_id)
    crud.set_default_style(db, style)
    db.commit()
    db.refresh(style)
    return BadgeStylePublic.model_validate(style)


@styles_router.delete("/{style_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_badge_style(
    style_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> None:
    style = _get_style_or_404(db, style_id)
    if style.is_default:
        raise _conflict("Pick another default style before deleting this one")
    # A badge must keep at least one image: refuse if this style holds the
    # only artwork of any badge.
    images = db.exec(select(BadgeImages).where(BadgeImages.style_id == style_id)).all()
    for image in images:
        others = db.exec(
            select(BadgeImages.id).where(
                BadgeImages.badge_id == image.badge_id,
                BadgeImages.style_id != style_id,
            )
        ).first()
        if others is None:
            raise _conflict(
                "Some badges only have artwork in this style; add another image first"
            )
    db.delete(style)
    db.commit()


# ---------------------------------------------------------------------------
# Awards (literal paths first so they are not read as a badge id)
# ---------------------------------------------------------------------------


@router.get("/awards", response_model=ListModel[BadgeAwardPublic])
async def list_badge_awards(
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
    human_id: uuid.UUID | None = None,
    email: str | None = None,
    badge_id: uuid.UUID | None = None,
    include_revoked: bool = False,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[BadgeAwardPublic]:
    """Awards of the tenant, filterable by recipient (id or email) and badge.

    ``email`` lets integrations such as AgentVillage look someone up without
    knowing their EdgeOS id. An unknown email returns an empty page.
    """
    if email:
        human = crud.find_human_by_email(db, email)
        if not human or (human_id and human.id != human_id):
            return ListModel[BadgeAwardPublic](
                results=[], paging=Paging(offset=skip, limit=limit, total=0)
            )
        human_id = human.id
    awards, total = crud.list_awards(
        db,
        human_id=human_id,
        badge_id=badge_id,
        include_revoked=include_revoked,
        skip=skip,
        limit=limit,
    )
    resolver = crud.ImageResolver(crud.list_styles(db))
    return ListModel[BadgeAwardPublic](
        results=crud.to_award_public(db, awards, resolver),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("/awards/{award_id}/revoke", response_model=BadgeAwardPublic)
async def revoke_badge_award(
    award_id: uuid.UUID,
    body: BadgeAwardRevoke,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
) -> BadgeAwardPublic:
    award = db.get(BadgeAwards, award_id)
    if not award:
        raise _not_found("Badge award")
    try:
        award = crud.revoke_award(
            db, award, revoked_by_user_id=current_user.id, reason=body.reason
        )
    except crud.BadgeConflictError as exc:
        raise _conflict(str(exc))
    resolver = crud.ImageResolver(crud.list_styles(db))
    return crud.to_award_public(db, [award], resolver)[0]


# ---------------------------------------------------------------------------
# Portal
# ---------------------------------------------------------------------------


@router.get(
    "/portal/me",
    response_model=list[MyBadge],
    summary="List your badges",
    dependencies=[needs("portal:profile:read")],
)
async def list_my_badges(
    current_human: CurrentHuman,
    db: HumanTenantSession,
) -> list[MyBadge]:
    return crud.my_badges(db, current_human.id)


@router.get(
    "/portal/issuable",
    response_model=list[IssuableBadge],
    summary="List the badges you can give in a popup",
    dependencies=[needs("portal:profile:read")],
)
async def list_issuable_badges(
    popup_id: uuid.UUID,
    current_human: CurrentHuman,
    db: HumanTenantSession,
    attendee_id: uuid.UUID | None = None,
) -> list[IssuableBadge]:
    """With ``attendee_id``, flags the badges that attendee already holds."""
    from app.api.attendee.models import Attendees

    recipient_id = None
    if attendee_id is not None:
        attendee = db.get(Attendees, attendee_id)
        if attendee and attendee.popup_id == popup_id:
            recipient_id = attendee.human_id
    return policies.issuable_badges(db, current_human.id, popup_id, recipient_id)


@router.post(
    "/portal/awards",
    response_model=SentBadgeAward,
    status_code=status.HTTP_201_CREATED,
    summary="Give a badge to another attendee",
    dependencies=[needs("portal:badges:write")],
)
async def give_badge_as_human(
    body: PortalBadgeAwardCreate,
    current_human: CurrentHuman,
    db: HumanTenantSession,
) -> SentBadgeAward:
    """Give a badge to an attendee of the popup under one of your policies.

    The recipient is addressed by attendee id (what the directory exposes)
    and must hold a ticket for the popup. 403 when no policy lets you give
    this badge, 429 when your allowance for it is used up.
    """
    from app.api.attendee.models import Attendees
    from app.api.event_participant.crud import event_participants_crud

    badge = _get_badge_or_404(db, body.badge_id)
    attendee = db.get(Attendees, body.attendee_id)
    if not attendee or attendee.popup_id != body.popup_id or not attendee.human_id:
        raise _not_found("Attendee")
    eligible = event_participants_crud.eligibility_by_human(
        db, body.popup_id, {attendee.human_id}
    )
    recipient = db.get(Humans, attendee.human_id)
    if not recipient or not eligible[attendee.human_id].allowed:
        raise _not_found("Attendee")

    try:
        award = policies.award_as_human(
            db,
            issuer_id=current_human.id,
            badge=badge,
            recipient=recipient,
            popup_id=body.popup_id,
            message=body.message,
        )
    except policies.BadgeForbiddenError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    except policies.AllowanceExhaustedError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You have no more of this badge to give for now",
            headers=(
                {"X-Allowance-Resets-At": exc.resets_at.isoformat()}
                if exc.resets_at
                else None
            ),
        )
    except crud.BadgeConflictError as exc:
        raise _conflict(str(exc))
    resolver = crud.ImageResolver(crud.list_styles(db))
    return SentBadgeAward(
        id=award.id,
        badge=crud.to_badge_summary(award.badge, resolver),
        recipient_name=recipient.full_name,
        popup_id=award.popup_id,
        message=award.message,
        awarded_at=award.awarded_at,
    )


@router.get(
    "/portal/sent",
    response_model=list[SentBadgeAward],
    summary="List the badges you gave",
    dependencies=[needs("portal:profile:read")],
)
async def list_sent_badges(
    current_human: CurrentHuman,
    db: HumanTenantSession,
    popup_id: uuid.UUID | None = None,
) -> list[SentBadgeAward]:
    return crud.list_sent(db, current_human.id, popup_id)


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


@router.get("", response_model=ListModel[BadgePublic])
async def list_badges(
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
    include_archived: bool = False,
    search: str | None = None,
    category: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[BadgePublic]:
    badges, total = crud.list_badges(
        db,
        include_archived=include_archived,
        search=search,
        category=category,
        skip=skip,
        limit=limit,
    )
    resolver = crud.ImageResolver(crud.list_styles(db))
    counts = crud.award_counts(db, [b.id for b in badges])
    return ListModel[BadgePublic](
        results=[
            crud.to_badge_public(b, resolver, counts.get(b.id, 0)) for b in badges
        ],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("", response_model=BadgePublic, status_code=status.HTTP_201_CREATED)
async def create_badge(
    badge_in: BadgeCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
    x_tenant_id: _XTenantId = None,
) -> BadgePublic:
    tenant_id = _tenant_id(current_user, x_tenant_id)
    if badge_in.style_override_id:
        _get_style_or_404(db, badge_in.style_override_id)
    style_ids = [img.style_id for img in badge_in.images]
    if len(set(style_ids)) != len(style_ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only one image per style",
        )
    for style_id in style_ids:
        _get_style_or_404(db, style_id)

    badge = Badges(
        tenant_id=tenant_id,
        slug=crud.unique_badge_slug(db, tenant_id, badge_in.slug or badge_in.name),
        name=badge_in.name,
        description=badge_in.description,
        category=badge_in.category,
        style_override_id=badge_in.style_override_id,
        repeatable=badge_in.repeatable,
    )
    db.add(badge)
    db.flush()
    for img in badge_in.images:
        crud.upsert_image(db, badge, img.style_id, img.image_url, img.width, img.height)
    for recipient_in in {r.human_id: r for r in badge_in.recipients}.values():
        recipient = db.get(Humans, recipient_in.human_id)
        if not recipient:
            raise _not_found("Human")
        crud.create_award(
            db,
            badge=badge,
            recipient=recipient,
            issuer_type=BadgeIssuerType.ADMIN,
            issuer_user_id=current_user.id,
            issuer_name=current_user.full_name or current_user.email,
            message=recipient_in.message,
            commit=False,
        )
    for policy_in in badge_in.issuer_policies:
        _add_policy(db, tenant_id, policy_in, also=badge)
    new_rules = [
        (
            _add_rule(db, tenant_id, badge.id, rule_in.config, rule_in.is_active),
            rule_in.evaluate_now,
        )
        for rule_in in badge_in.rules
    ]
    db.commit()
    db.refresh(badge)
    for rule, evaluate_now in new_rules:
        if evaluate_now:
            _evaluate_quietly(db, rule)
    return _badge_public(db, badge)


@router.get("/{badge_id}", response_model=BadgePublic)
async def get_badge(
    badge_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
) -> BadgePublic:
    return _badge_public(db, _get_badge_or_404(db, badge_id))


@router.patch("/{badge_id}", response_model=BadgePublic)
async def update_badge(
    badge_id: uuid.UUID,
    badge_in: BadgeUpdate,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgePublic:
    badge = _get_badge_or_404(db, badge_id)
    data = badge_in.model_dump(exclude_unset=True)

    if data.get("style_override_id"):
        _get_style_or_404(db, data["style_override_id"])
    repeatable = data.pop("repeatable", None)
    if repeatable is not None and repeatable != badge.repeatable:
        # Awards denormalize repeatable into is_unique, so flipping it after
        # the fact would leave the duplicate guard out of sync.
        if crud.has_any_award(db, badge.id):
            raise _conflict("Repeatable can't change once the badge was awarded")
        badge.repeatable = repeatable
    archived = data.pop("archived", None)
    if archived is not None:
        badge.archived_at = (
            (badge.archived_at or datetime.now(UTC)) if archived else None
        )
    for field in ("name", "description", "category", "style_override_id"):
        if field in data:
            if field == "name" and data[field] is None:
                continue
            setattr(badge, field, data[field])
    crud.touch(badge)
    db.add(badge)
    db.commit()
    db.refresh(badge)
    return _badge_public(db, badge)


@router.delete("/{badge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_badge(
    badge_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> None:
    """Delete a never-awarded badge; archive one that has awards.

    Archiving keeps every award (and the recipients' profiles) intact and only
    removes the badge from the catalog of badges that can be given.
    """
    badge = _get_badge_or_404(db, badge_id)
    if crud.has_any_award(db, badge.id):
        if badge.archived_at is None:
            badge.archived_at = datetime.now(UTC)
            crud.touch(badge)
            db.add(badge)
            db.commit()
        return
    db.delete(badge)
    db.commit()


@router.put("/{badge_id}/images/{style_id}", response_model=BadgePublic)
async def put_badge_image(
    badge_id: uuid.UUID,
    style_id: uuid.UUID,
    image_in: BadgeImageUpsert,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgePublic:
    badge = _get_badge_or_404(db, badge_id)
    _get_style_or_404(db, style_id)
    crud.upsert_image(
        db, badge, style_id, image_in.image_url, image_in.width, image_in.height
    )
    crud.touch(badge)
    db.add(badge)
    db.commit()
    db.refresh(badge)
    return _badge_public(db, badge)


@router.delete("/{badge_id}/images/{style_id}", response_model=BadgePublic)
async def delete_badge_image(
    badge_id: uuid.UUID,
    style_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgePublic:
    badge = _get_badge_or_404(db, badge_id)
    image = next((img for img in badge.images if img.style_id == style_id), None)
    if image is None:
        raise _not_found("Badge image")
    if len(badge.images) == 1:
        raise _conflict("A badge needs at least one image")
    badge.images.remove(image)
    crud.touch(badge)
    db.add(badge)
    db.commit()
    db.refresh(badge)
    return _badge_public(db, badge)


@router.post(
    "/{badge_id}/awards",
    response_model=BadgeAwardPublic,
    status_code=status.HTTP_201_CREATED,
)
async def award_badge(
    badge_id: uuid.UUID,
    award_in: BadgeAwardCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
) -> BadgeAwardPublic:
    badge = _get_badge_or_404(db, badge_id)
    if award_in.recipient_human_id:
        recipient = db.get(Humans, award_in.recipient_human_id)
    else:
        recipient = crud.find_human_by_email(db, award_in.recipient_email or "")
    if not recipient:
        raise _not_found("Human")
    if award_in.popup_id:
        from app.api.popup.crud import popups_crud

        if not popups_crud.get(db, award_in.popup_id):
            raise _not_found("Popup")

    try:
        award = crud.create_award(
            db,
            badge=badge,
            recipient=recipient,
            issuer_type=BadgeIssuerType.ADMIN,
            issuer_user_id=current_user.id,
            issuer_name=current_user.full_name or current_user.email,
            popup_id=award_in.popup_id,
            message=award_in.message,
        )
    except crud.BadgeConflictError as exc:
        raise _conflict(str(exc))
    resolver = crud.ImageResolver(crud.list_styles(db))
    return crud.to_award_public(db, [award], resolver)[0]


@router.post(
    "/{badge_id}/awards/bulk",
    response_model=BadgeBulkAwardResult,
    status_code=status.HTTP_201_CREATED,
)
async def award_badge_bulk(
    badge_id: uuid.UUID,
    award_in: BadgeBulkAwardCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
) -> BadgeBulkAwardResult:
    """Give a badge to many people in one go.

    People who already hold a non-repeatable badge are skipped, and pasted
    emails that match nobody are reported back instead of failing the batch.
    Everyone else gets it atomically.
    """
    badge = _get_badge_or_404(db, badge_id)
    if badge.archived_at is not None:
        raise _conflict("This badge is archived")
    if award_in.popup_id:
        from app.api.popup.crud import popups_crud

        if not popups_crud.get(db, award_in.popup_id):
            raise _not_found("Popup")

    by_id: dict[uuid.UUID, Humans] = {}
    if award_in.recipient_human_ids:
        found = db.exec(
            select(Humans).where(col(Humans.id).in_(award_in.recipient_human_ids))
        ).all()
        by_id = {h.id: h for h in found}
        if len(by_id) != len(set(award_in.recipient_human_ids)):
            raise _not_found("Human")
    unknown_emails: list[str] = []
    if award_in.recipient_emails:
        # Emails are stored lowercased (see crud.find_human_by_email).
        found = db.exec(
            select(Humans).where(col(Humans.email).in_(award_in.recipient_emails))
        ).all()
        by_email = {h.email: h for h in found}
        unknown_emails = [e for e in award_in.recipient_emails if e not in by_email]
        for human in by_email.values():
            by_id.setdefault(human.id, human)

    awards: list[BadgeAwards] = []
    already_had: list[BadgeAwardRecipient] = []
    try:
        for recipient in by_id.values():
            try:
                awards.append(
                    crud.create_award(
                        db,
                        badge=badge,
                        recipient=recipient,
                        issuer_type=BadgeIssuerType.ADMIN,
                        issuer_user_id=current_user.id,
                        issuer_name=current_user.full_name or current_user.email,
                        popup_id=award_in.popup_id,
                        message=award_in.message,
                        commit=False,
                    )
                )
            except crud.BadgeConflictError:
                already_had.append(
                    BadgeAwardRecipient.model_validate(recipient, from_attributes=True)
                )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("Someone else just gave this badge; try again")

    resolver = crud.ImageResolver(crud.list_styles(db))
    return BadgeBulkAwardResult(
        awarded=crud.to_award_public(db, awards, resolver),
        already_had=already_had,
        unknown_emails=unknown_emails,
    )


# ---------------------------------------------------------------------------
# Issuer policies (who besides admins can give which badges)
# ---------------------------------------------------------------------------


def _policy_public(db: Session, policy: BadgeIssuerPolicies) -> BadgeIssuerPolicyPublic:
    resolver = crud.ImageResolver(crud.list_styles(db))
    return BadgeIssuerPolicyPublic(
        id=policy.id,
        name=policy.name,
        audience_type=BadgeAudienceType(policy.audience_type),
        popup_id=policy.popup_id,
        allowance_quantity=policy.allowance_quantity,
        allowance_window=AllowanceWindow(policy.allowance_window),
        is_active=policy.is_active,
        badges=[crud.to_badge_summary(b, resolver) for b in policy.badges],
        humans=[
            BadgeIssuerPolicyHuman(
                id=h.id, email=h.email, first_name=h.first_name, last_name=h.last_name
            )
            for h in policy.humans
        ],
        emails=list(policy.emails or []),
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


def _get_policy_or_404(db: Session, policy_id: uuid.UUID) -> BadgeIssuerPolicies:
    policy = db.get(BadgeIssuerPolicies, policy_id)
    if not policy:
        raise _not_found("Issuer policy")
    return policy


def _resolve_policy_links(
    db: Session,
    badge_ids: list[uuid.UUID] | None,
    human_ids: list[uuid.UUID] | None,
    popup_id: uuid.UUID | None,
) -> tuple[list[Badges] | None, list[Humans] | None]:
    from app.api.popup.crud import popups_crud

    if popup_id and not popups_crud.get(db, popup_id):
        raise _not_found("Popup")
    badges = None
    if badge_ids is not None:
        badges = [_get_badge_or_404(db, b) for b in dict.fromkeys(badge_ids)]
    humans = None
    if human_ids is not None:
        humans = []
        for human_id in dict.fromkeys(human_ids):
            human = db.get(Humans, human_id)
            if not human:
                raise _not_found("Human")
            humans.append(human)
    return badges, humans


def _set_links(
    db: Session,
    policy: BadgeIssuerPolicies,
    badges: list[Badges] | None,
    humans: list[Humans] | None,
) -> None:
    """Replace the policy's badge and/or human links (None leaves them as is).

    Link rows are written explicitly (the relationships are read-only) so
    each one carries the tenant_id RLS needs.
    """
    from sqlalchemy import delete

    from app.api.badge.models import BadgeIssuerPolicyBadges, BadgeIssuerPolicyHumans

    if badges is not None:
        db.exec(
            delete(BadgeIssuerPolicyBadges).where(
                BadgeIssuerPolicyBadges.policy_id == policy.id
            )
        )
        for badge in badges:
            db.add(
                BadgeIssuerPolicyBadges(
                    policy_id=policy.id, badge_id=badge.id, tenant_id=policy.tenant_id
                )
            )
    if humans is not None:
        db.exec(
            delete(BadgeIssuerPolicyHumans).where(
                BadgeIssuerPolicyHumans.policy_id == policy.id
            )
        )
        for human in humans:
            db.add(
                BadgeIssuerPolicyHumans(
                    policy_id=policy.id, human_id=human.id, tenant_id=policy.tenant_id
                )
            )


@policies_router.get("", response_model=list[BadgeIssuerPolicyPublic])
async def list_issuer_policies(
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
    badge_id: uuid.UUID | None = None,
) -> list[BadgeIssuerPolicyPublic]:
    found = [
        p
        for p in db.exec(
            select(BadgeIssuerPolicies).order_by(col(BadgeIssuerPolicies.name))
        ).all()
        if badge_id is None or any(b.id == badge_id for b in p.badges)
    ]
    return [_policy_public(db, p) for p in found]


@policies_router.post(
    "", response_model=BadgeIssuerPolicyPublic, status_code=status.HTTP_201_CREATED
)
async def create_issuer_policy(
    body: BadgeIssuerPolicyCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
    x_tenant_id: _XTenantId = None,
) -> BadgeIssuerPolicyPublic:
    policy = _add_policy(db, _tenant_id(current_user, x_tenant_id), body)
    db.commit()
    db.refresh(policy)
    return _policy_public(db, policy)


def _add_policy(
    db: Session,
    tenant_id: uuid.UUID,
    body: BadgeIssuerPolicyCreate,
    also: Badges | None = None,
) -> BadgeIssuerPolicies:
    """Stage a policy and its links (no commit). ``also`` joins its badges."""
    badges, humans = _resolve_policy_links(
        db, body.badge_ids, body.human_ids, body.popup_id
    )
    badges = [b for b in badges or [] if also is None or b.id != also.id]
    if also is not None:
        badges.insert(0, also)
    policy = BadgeIssuerPolicies(
        tenant_id=tenant_id,
        name=body.name,
        audience_type=body.audience_type.value,
        popup_id=body.popup_id,
        allowance_quantity=body.allowance_quantity,
        allowance_window=body.allowance_window.value,
        is_active=body.is_active,
        emails=body.emails if body.audience_type == BadgeAudienceType.EMAILS else [],
    )
    db.add(policy)
    db.flush()
    _set_links(
        db,
        policy,
        badges,
        humans if body.audience_type == BadgeAudienceType.HUMANS else [],
    )
    return policy


@policies_router.get("/{policy_id}", response_model=BadgeIssuerPolicyPublic)
async def get_issuer_policy(
    policy_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
) -> BadgeIssuerPolicyPublic:
    return _policy_public(db, _get_policy_or_404(db, policy_id))


@policies_router.patch("/{policy_id}", response_model=BadgeIssuerPolicyPublic)
async def update_issuer_policy(
    policy_id: uuid.UUID,
    body: BadgeIssuerPolicyUpdate,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgeIssuerPolicyPublic:
    from app.api.badge.schemas import check_policy_shape

    policy = _get_policy_or_404(db, policy_id)
    data = body.model_dump(exclude_unset=True)
    audience = BadgeAudienceType(data.get("audience_type") or policy.audience_type)
    popup_id = data["popup_id"] if "popup_id" in data else policy.popup_id
    window = AllowanceWindow(data.get("allowance_window") or policy.allowance_window)
    try:
        check_policy_shape(audience, popup_id, window)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        )
    badges, humans = _resolve_policy_links(
        db, data.get("badge_ids"), data.get("human_ids"), popup_id
    )

    if data.get("name"):
        policy.name = data["name"]
    policy.audience_type = audience.value
    policy.popup_id = popup_id
    if "allowance_quantity" in data:
        policy.allowance_quantity = data["allowance_quantity"]
    policy.allowance_window = window.value
    if data.get("is_active") is not None:
        policy.is_active = data["is_active"]
    if audience != BadgeAudienceType.EMAILS:
        policy.emails = []
    elif data.get("emails") is not None:
        policy.emails = data["emails"]
    if audience == BadgeAudienceType.EMAILS and not policy.emails:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="An emails audience needs at least one email",
        )
    policy.updated_at = datetime.now(UTC)
    db.add(policy)
    if audience != BadgeAudienceType.HUMANS:
        humans = []
    _set_links(db, policy, badges, humans)
    db.commit()
    db.refresh(policy)
    return _policy_public(db, policy)


@policies_router.delete("/{policy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_issuer_policy(
    policy_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> None:
    """Delete a policy. Awards given under it stay; they just stop counting."""
    db.delete(_get_policy_or_404(db, policy_id))
    db.commit()


# ---------------------------------------------------------------------------
# Automatic rules (badges earned from attending or hosting)
# ---------------------------------------------------------------------------


def _rule_public(db: Session, rule: BadgeRules) -> BadgeRulePublic:
    count = db.exec(
        select(func.count()).where(
            BadgeAwards.rule_id == rule.id, col(BadgeAwards.revoked_at).is_(None)
        )
    ).one()
    return BadgeRulePublic(
        id=rule.id,
        badge_id=rule.badge_id,
        config=rules.parse_config(rule),
        is_active=rule.is_active,
        award_count=count,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
    )


def _get_rule_or_404(db: Session, rule_id: uuid.UUID) -> BadgeRules:
    rule = db.get(BadgeRules, rule_id)
    if not rule:
        raise _not_found("Badge rule")
    return rule


def _check_rule_target(
    db: Session, tenant_id: uuid.UUID, config: BadgeRuleConfig
) -> None:
    """Every popup, track, venue and event a rule names must exist here."""
    from app.api.event.models import Events
    from app.api.event_venue.models import EventVenues
    from app.api.popup.models import Popups
    from app.api.track.models import Tracks

    wanted: dict[str, tuple[type, set[uuid.UUID]]] = {
        "Popup": (Popups, set()),
        "Track": (Tracks, set()),
        "Venue": (EventVenues, set()),
        "Event": (Events, set()),
    }
    for condition in config.conditions:
        f = condition.filters
        if f.popup_id:
            wanted["Popup"][1].add(f.popup_id)
        wanted["Track"][1].update(f.track_ids)
        wanted["Venue"][1].update(f.venue_ids)
        wanted["Event"][1].update(f.event_ids)
    for label, (model, ids) in wanted.items():
        if not ids:
            continue
        found = db.exec(
            select(func.count()).where(
                col(model.id).in_(ids), model.tenant_id == tenant_id
            )
        ).one()
        if found != len(ids):
            raise _not_found(label)


def _sorted_unique(values) -> list[str]:
    seen: dict[str, str] = {}
    for value in values:
        value = (value or "").strip()
        if value:
            seen.setdefault(value.casefold(), value)
    return sorted(seen.values(), key=str.casefold)


@rules_router.get("/options", response_model=BadgeRuleOptions)
async def badge_rule_options(
    popup_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
) -> BadgeRuleOptions:
    """Tags and kinds a rule can filter by: the curated lists plus used ones."""
    from app.api.event.crud import events_crud
    from app.api.event.models import Events
    from app.api.event_settings.crud import event_settings_crud

    settings = event_settings_crud.get_by_popup_id(db, popup_id)
    used_kinds = db.exec(
        select(Events.kind)
        .where(Events.popup_id == popup_id, col(Events.kind).is_not(None))
        .distinct()
    ).all()
    return BadgeRuleOptions(
        tags=_sorted_unique(
            [
                *(settings.allowed_tags if settings else []),
                *events_crud.list_distinct_tags(db, popup_id=popup_id),
            ]
        ),
        kinds=_sorted_unique(
            [*(settings.allowed_kinds if settings else []), *used_kinds]
        ),
    )


@rules_router.post("/preview", response_model=BadgeRulePreview)
async def preview_badge_rule(
    body: BadgeRulePreviewRequest,
    db: AdminOrApiKeySession_BadgesRead,
    current_user: AdminOrApiKey_BadgesRead,
    x_tenant_id: _XTenantId = None,
) -> BadgeRulePreview:
    """How many people meet a rule right now, without saving or awarding."""
    tenant_id = _tenant_id(current_user, x_tenant_id)
    badge = _get_badge_or_404(db, body.badge_id) if body.badge_id else None
    _check_rule_target(db, tenant_id, body.config)
    qualified, new = rules.preview(db, tenant_id, badge, body.config)
    return BadgeRulePreview(qualified=qualified, new_recipients=new)


def _add_rule(
    db: Session,
    tenant_id: uuid.UUID,
    badge_id: uuid.UUID,
    config: BadgeRuleConfig,
    is_active: bool,
) -> BadgeRules:
    """Stage a rule (no commit) after checking what it points at."""
    _check_rule_target(db, tenant_id, config)
    rule = BadgeRules(
        tenant_id=tenant_id,
        badge_id=badge_id,
        type=rules.RULE_CONFIG_TYPE,
        config=config.model_dump(mode="json"),
        is_active=is_active,
    )
    db.add(rule)
    return rule


def _evaluate_quietly(db: Session, rule: BadgeRules) -> None:
    """Award a just-saved rule; on failure the sweep retries it later."""
    try:
        rules.evaluate_rule(db, rule)
    except Exception:
        db.rollback()
        logger.exception("Evaluating new badge rule {} failed", rule.id)


@rules_router.get("", response_model=list[BadgeRulePublic])
async def list_badge_rules(
    db: AdminOrApiKeySession_BadgesRead,
    _: AdminOrApiKey_BadgesRead,
    badge_id: uuid.UUID | None = None,
) -> list[BadgeRulePublic]:
    statement = select(BadgeRules).order_by(col(BadgeRules.created_at))
    if badge_id:
        statement = statement.where(BadgeRules.badge_id == badge_id)
    return [_rule_public(db, r) for r in db.exec(statement).all()]


@rules_router.post(
    "", response_model=BadgeRulePublic, status_code=status.HTTP_201_CREATED
)
async def create_badge_rule(
    body: BadgeRuleCreate,
    db: AdminOrApiKeySession_BadgesWrite,
    current_user: AdminOrApiKey_BadgesWrite,
    x_tenant_id: _XTenantId = None,
) -> BadgeRulePublic:
    """Create a rule; by default it also awards everyone who already qualifies."""
    tenant_id = _tenant_id(current_user, x_tenant_id)
    _get_badge_or_404(db, body.badge_id)
    rule = _add_rule(db, tenant_id, body.badge_id, body.config, body.is_active)
    db.commit()
    db.refresh(rule)
    if body.evaluate_now:
        rules.evaluate_rule(db, rule)
        db.refresh(rule)
    return _rule_public(db, rule)


@rules_router.patch("/{rule_id}", response_model=BadgeRulePublic)
async def update_badge_rule(
    rule_id: uuid.UUID,
    body: BadgeRuleUpdate,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgeRulePublic:
    """Edit a rule. Awards already given stay; run evaluate to apply it now."""
    rule = _get_rule_or_404(db, rule_id)
    if body.config is not None:
        _check_rule_target(db, rule.tenant_id, body.config)
        rule.type = rules.RULE_CONFIG_TYPE
        rule.config = body.config.model_dump(mode="json")
    if body.is_active is not None:
        rule.is_active = body.is_active
    rule.updated_at = datetime.now(UTC)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _rule_public(db, rule)


@rules_router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_badge_rule(
    rule_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> None:
    """Delete a rule. Badges it already gave are kept."""
    db.delete(_get_rule_or_404(db, rule_id))
    db.commit()


@rules_router.post("/{rule_id}/evaluate", response_model=BadgeRuleEvaluation)
async def evaluate_badge_rule(
    rule_id: uuid.UUID,
    db: AdminOrApiKeySession_BadgesWrite,
    _: AdminOrApiKey_BadgesWrite,
) -> BadgeRuleEvaluation:
    """Award the badge to everyone who meets the rule and doesn't have it yet."""
    rule = _get_rule_or_404(db, rule_id)
    return BadgeRuleEvaluation(rule_id=rule.id, awarded=rules.evaluate_rule(db, rule))
