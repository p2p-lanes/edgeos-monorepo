import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from sqlmodel import Session, select

from app.api.badge import crud
from app.api.badge.models import BadgeAwards, BadgeImages, Badges, BadgeStyles
from app.api.badge.schemas import (
    BadgeAwardCreate,
    BadgeAwardPublic,
    BadgeAwardRevoke,
    BadgeCreate,
    BadgeImageUpsert,
    BadgeIssuerType,
    BadgePublic,
    BadgeStyleCreate,
    BadgeStylePublic,
    BadgeStyleUpdate,
    BadgeUpdate,
    MyBadge,
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
    db.commit()
    db.refresh(badge)
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
