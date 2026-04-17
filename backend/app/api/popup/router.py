import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.api.approval_strategy.crud import approval_strategies_crud
from app.api.approval_strategy.schemas import (
    ApprovalStrategyCreate,
    ApprovalStrategyType,
)
from app.api.base_field_config.constants import DEFAULT_SECTIONS
from app.api.base_field_config.crud import base_field_configs_crud
from app.api.form_section.models import FormSections
from app.api.popup import crud
from app.api.popup.schemas import (
    PopupAdmin,
    PopupCreate,
    PopupPublic,
    PopupStatus,
    PopupUpdate,
)
from app.api.shared.enums import SaleType, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.translation.service import (
    TRANSLATABLE_FIELDS,
    apply_translation_overlay,
    delete_translations_for_entity,
    get_translations_bulk,
    get_translations_for_entity,
)
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)

router = APIRouter(prefix="/popups", tags=["popups"])


@router.get("", response_model=ListModel[PopupAdmin])
async def list_popups(
    db: TenantSession,
    _: CurrentUser,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PopupAdmin]:
    popups, total = crud.find(
        db, skip=skip, limit=limit, search=search, search_fields=["name"]
    )

    return ListModel[PopupAdmin](
        results=[PopupAdmin.model_validate(p) for p in popups],
        paging=Paging(
            offset=skip,
            limit=limit,
            total=total,
        ),
    )


@router.get("/public/list", response_model=list[PopupPublic])
async def list_public_popups(
    session: SessionDep,
    x_tenant_id: Annotated[str, Header(alias="X-Tenant-Id")],
) -> list[PopupPublic]:
    """List active popups for a tenant (public, no auth required). Used by checkout flow."""
    tenant_id = uuid.UUID(x_tenant_id)
    popups, _ = crud.find(session, status=PopupStatus.active, tenant_id=tenant_id)
    return [PopupPublic.model_validate(p) for p in popups]


@router.get("/{popup_id}", response_model=PopupAdmin)
async def get_popup(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> PopupAdmin:
    popup = crud.get(db, popup_id)

    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    return PopupAdmin.model_validate(popup)


@router.post("", response_model=PopupAdmin, status_code=status.HTTP_201_CREATED)
async def create_popup(
    popup_in: PopupCreate,
    db: TenantSession,
    current_user: CurrentWriter,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> PopupAdmin:
    if current_user.role == UserRole.SUPERADMIN:
        if x_tenant_id:
            popup_in.tenant_id = uuid.UUID(x_tenant_id)
        elif popup_in.tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Superadmin must provide tenant_id",
            )
    else:
        popup_in.tenant_id = current_user.tenant_id

    existing = crud.get_by_slug(db, popup_in.slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A popup with this slug already exists",
        )

    popup = crud.create(db, popup_in)

    # Direct-sale popups skip the application-centric bootstrap (no approval
    # strategy, no form sections, no base field configs). Only ticketing steps
    # are seeded so the ticketing flow is always available.
    if popup.sale_type == SaleType.application.value:
        # Create default auto-accept approval strategy for the popup
        approval_strategies_crud.create_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            strategy_in=ApprovalStrategyCreate(
                strategy_type=ApprovalStrategyType.AUTO_ACCEPT
            ),
        )

        # Create default form sections and base field configs
        # Feature-gated sections are only created when their flag is enabled
        section_map: dict[str, uuid.UUID] = {}
        for key, section_def in DEFAULT_SECTIONS.items():
            if key == "scholarship" and not popup.allows_scholarship:
                continue
            if (
                key == "companions"
                and not popup.allows_spouse
                and not popup.allows_children
            ):
                continue
            section = FormSections(
                tenant_id=popup.tenant_id,
                popup_id=popup.id,
                label=section_def["label"],
                order=section_def["order"],
                protected=True,
            )
            db.add(section)
            db.commit()
            db.refresh(section)
            section_map[key] = section.id

        base_field_configs_crud.create_defaults_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            section_map=section_map,
        )

    seed_ticketing_steps_for_popup(db, popup_id=popup.id, tenant_id=popup.tenant_id)

    return PopupAdmin.model_validate(popup)


@router.patch("/{popup_id}", response_model=PopupAdmin)
async def update_popup(
    popup_id: uuid.UUID,
    popup_in: PopupUpdate,
    request: Request,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> PopupAdmin:
    # Immutability guard: sale_type is set at creation time and cannot be
    # changed. Reject with 422 if the client attempts to modify it. We inspect
    # the raw body (not popup_in) because sale_type is intentionally absent
    # from PopupUpdate — Pydantic would silently drop it.
    raw_body = await request.json()
    if isinstance(raw_body, dict) and "sale_type" in raw_body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="sale_type is immutable and cannot be updated",
        )

    popup = crud.get(db, popup_id)

    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    if popup_in.slug and popup_in.slug != popup.slug:
        existing = crud.get_by_slug(db, popup_in.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A popup with this slug already exists",
            )

    # Detect feature flags being enabled for the first time
    scholarship_enabling = (
        popup_in.allows_scholarship is True and not popup.allows_scholarship
    )
    companions_enabling = (
        not popup.allows_spouse
        and not popup.allows_children
        and (popup_in.allows_spouse is True or popup_in.allows_children is True)
    )

    updated = crud.update(db, popup, popup_in)

    # Create gated sections and base field configs on first enable
    section_map: dict[str, uuid.UUID] = {}
    for key, should_create in [
        ("scholarship", scholarship_enabling),
        ("companions", companions_enabling),
    ]:
        if not should_create:
            continue
        section_def = DEFAULT_SECTIONS[key]
        section = FormSections(
            tenant_id=updated.tenant_id,
            popup_id=updated.id,
            label=section_def["label"],
            order=section_def["order"],
            protected=True,
        )
        db.add(section)
        db.commit()
        db.refresh(section)
        section_map[key] = section.id

    if section_map:
        base_field_configs_crud.create_defaults_for_popup(
            db,
            popup_id=updated.id,
            tenant_id=updated.tenant_id,
            section_map=section_map,
        )

    return PopupAdmin.model_validate(updated)


@router.delete("/{popup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_popup(
    popup_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    popup = crud.get(db, popup_id)

    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    # Clean up translations for the popup and its child entities
    for field in popup.form_fields:
        delete_translations_for_entity(db, "form_field", field.id)
    for section in popup.form_sections:
        delete_translations_for_entity(db, "form_section", section.id)
    for product in popup.products:
        delete_translations_for_entity(db, "product", product.id)
    for group in popup.groups:
        delete_translations_for_entity(db, "group", group.id)
    delete_translations_for_entity(db, "popup", popup.id)

    crud.delete(db, popup)


@router.get("/portal/list", response_model=list[PopupPublic])
async def list_portal_popups(
    db: HumanTenantSession,
    _: CurrentHuman,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> list[PopupPublic]:
    """List active popups for the current human's tenant (Portal)."""
    popups, _ = crud.find(db, status=PopupStatus.active, limit=100)

    if not accept_language or accept_language == "en":
        return [PopupPublic.model_validate(p) for p in popups]

    lang = accept_language.split(",")[0].split("-")[0].strip()
    popup_ids = [p.id for p in popups]
    translations_map = get_translations_bulk(db, "popup", popup_ids, lang)

    results = []
    for p in popups:
        data = PopupPublic.model_validate(p).model_dump()
        data = apply_translation_overlay(data, translations_map.get(p.id), TRANSLATABLE_FIELDS["popup"])
        results.append(PopupPublic.model_validate(data))
    return results


@router.get("/portal/{slug}", response_model=PopupPublic)
async def get_portal_popup(
    slug: str,
    db: HumanTenantSession,
    _: CurrentHuman,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> PopupPublic:
    """Get a popup by slug (Portal)."""
    popup = crud.get_by_slug(db, slug)

    if not popup or popup.status != PopupStatus.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )

    if not accept_language or accept_language == "en":
        return PopupPublic.model_validate(popup)

    lang = accept_language.split(",")[0].split("-")[0].strip()
    translation = get_translations_for_entity(db, "popup", popup.id, lang)
    data = PopupPublic.model_validate(popup).model_dump()
    data = apply_translation_overlay(data, translation, TRANSLATABLE_FIELDS["popup"])
    return PopupPublic.model_validate(data)
