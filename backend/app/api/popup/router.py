import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.approval_strategy.crud import approval_strategies_crud
from app.api.approval_strategy.schemas import (
    ApprovalStrategyCreate,
    ApprovalStrategyType,
)
from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS, DEFAULT_SECTIONS
from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_section.models import FormSections
from app.api.payment.crud import payments_crud
from app.api.payment.schemas import PaymentStatus
from app.api.popup import crud
from app.api.popup.guards import (
    CallerToken,
    ensure_api_key_popup,
    is_popup_scoped_api_key,
)
from app.api.popup.models import Popups
from app.api.popup.schemas import (
    PopupAdmin,
    PopupCreate,
    PopupPublic,
    PopupStatus,
    PopupUpdate,
)
from app.api.sales_flow.crud import default_flow_name, popup_takes_applications
from app.api.shared.enums import LandingMode, UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.translation.service import (
    TRANSLATABLE_FIELDS,
    apply_translation_overlay,
    delete_translations_for_entity,
    get_translations_bulk,
    get_translations_for_entity,
    parse_accept_language,
)
from app.core.dependencies.users import (
    CurrentCheckInOperator,
    CurrentHuman,
    CurrentOperator,
    HumanTenantSession,
    SessionDep,
    TenantSession,
)
from app.services.image_ingestion import ImageIngestionService

router = APIRouter(prefix="/popups", tags=["popups"])


def _default_flow_or_500(db, popup_id: uuid.UUID):
    """The popup's default flow, which every popup has (provisioned at
    creation, backfilled by `4a983282b8aa`). Its absence is a broken popup,
    not an empty one — say so rather than writing a form row nowhere."""
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get_default_flow(db, popup_id)
    if flow is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Popup has no default sales flow",
        )
    return flow


def _create_form_section(
    db: TenantSession,
    *,
    popup: Popups,
    key: str,
    sales_flow_id: uuid.UUID,
) -> FormSections:
    section_def = DEFAULT_SECTIONS[key]
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        label=section_def["label"],
        order=section_def["order"],
        protected=True,
        kind=section_def["kind"],
    )
    db.add(section)
    db.commit()
    db.refresh(section)
    return section


def _seed_application_defaults(db: TenantSession, popup: Popups) -> None:
    from app.api.sales_flow.resolver import build_effective_config  # noqa: PLC0415

    # The form belongs to the popup's default flow (slice 3): a section or
    # base-field config has no other place to live.
    default_flow = _default_flow_or_500(db, popup.id)

    if popup.approval_strategy is None:
        approval_strategies_crud.create_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            strategy_in=ApprovalStrategyCreate(
                strategy_type=ApprovalStrategyType.AUTO_ACCEPT
            ),
        )

    existing_sections = {section.label: section for section in popup.form_sections}
    section_map: dict[str, uuid.UUID] = {}
    for key, section_def in DEFAULT_SECTIONS.items():
        # The sections being seeded belong to the default flow, so the flag
        # that decides whether to seed one comes from that same flow.
        if (
            key == "scholarship"
            and not build_effective_config(default_flow).allows_scholarship
        ):
            continue

        existing_section = existing_sections.get(section_def["label"])
        if existing_section is None:
            existing_section = _create_form_section(
                db, popup=popup, key=key, sales_flow_id=default_flow.id
            )
        section_map[key] = existing_section.id

    if popup.base_field_configs:
        return

    for field_name, definition in BASE_FIELD_DEFINITIONS.items():
        section_key = definition.get("default_section_key", "profile")
        if section_key not in section_map:
            continue
        db.add(
            BaseFieldConfigs(
                tenant_id=popup.tenant_id,
                popup_id=popup.id,
                sales_flow_id=default_flow.id,
                field_name=field_name,
                section_id=section_map[section_key],
                position=definition.get("default_position", 0),
                required=definition.get("required", False),
                label=definition.get("label"),
                placeholder=definition.get("default_placeholder"),
                help_text=definition.get("default_help_text"),
                options=definition.get("default_options"),
            )
        )
    db.commit()


@router.get("", response_model=ListModel[PopupAdmin])
async def list_popups(
    db: TenantSession,
    _: CurrentCheckInOperator,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[PopupAdmin]:
    popups, total = crud.find(
        db, skip=skip, limit=limit, search=search, search_fields=["name"]
    )

    return ListModel[PopupAdmin](
        results=_with_flow_kinds(
            db, popups, [PopupAdmin.model_validate(p) for p in popups]
        ),
        paging=Paging(
            offset=skip,
            limit=limit,
            total=total,
        ),
    )


def _with_flow_kinds(db, popups: list, models: list) -> list:
    """Stamp each serialized popup with what its doors do.

    One grouped query for the page (`flow_kinds_for_popups`), because this is
    read on every portal list and a lazy lookup per row would be an N+1 nobody
    notices until it is slow.
    """
    from app.api.sales_flow.crud import flow_kinds_for_popups

    kinds = flow_kinds_for_popups(db, [p.id for p in popups])
    for popup, model in zip(popups, models, strict=True):
        takes, sells = kinds.get(popup.id, (True, False))
        model.takes_applications = takes
        model.sells_directly = sells
    return models


@router.get("/public/list", response_model=list[PopupPublic])
async def list_public_popups(
    session: SessionDep,
    x_tenant_id: Annotated[str, Header(alias="X-Tenant-Id")],
) -> list[PopupPublic]:
    """List active popups for a tenant (public, no auth required). Used by checkout flow."""
    tenant_id = uuid.UUID(x_tenant_id)
    popups, _ = crud.find(session, status=PopupStatus.active, tenant_id=tenant_id)
    return _with_flow_kinds(
        session, popups, [PopupPublic.model_validate(p) for p in popups]
    )


@router.get("/{popup_id}", response_model=PopupAdmin)
async def get_popup(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentCheckInOperator,
) -> PopupAdmin:
    popup = crud.get(db, popup_id)

    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    return _with_flow_kinds(db, [popup], [PopupAdmin.model_validate(popup)])[0]


@router.post("", response_model=PopupAdmin, status_code=status.HTTP_201_CREATED)
async def create_popup(
    popup_in: PopupCreate,
    db: TenantSession,
    current_user: CurrentOperator,
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
            status_code=status.HTTP_409_CONFLICT,
            detail="A popup with this slug already exists in this tenant",
        )

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: any per-URL failure keeps the original URL.
    _svc = ImageIngestionService()
    tenant_id = popup_in.tenant_id  # already resolved above
    if popup_in.image_url is not None:
        popup_in.image_url = await _svc.ingest_url(popup_in.image_url, tenant_id)
    if popup_in.icon_url is not None:
        popup_in.icon_url = await _svc.ingest_url(popup_in.icon_url, tenant_id)
    if popup_in.favicon_url is not None:
        popup_in.favicon_url = await _svc.ingest_url(popup_in.favicon_url, tenant_id)
    if popup_in.express_checkout_background is not None:
        popup_in.express_checkout_background = await _svc.ingest_url(
            popup_in.express_checkout_background, tenant_id
        )

    try:
        popup = crud.create(db, popup_in)
    except IntegrityError as exc:
        db.rollback()
        if "uq_popups_tenant_slug" in str(getattr(exc, "orig", exc)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A popup with this slug already exists in this tenant",
            )
        raise

    # The default flow was provisioned in the same transaction as the popup
    # (task 5.0), and since sdd/sales-flows-rediseno slice 2 it owns the
    # seeded steps: a step has nowhere else to live. Its `type` also drives
    # the buyer-step gate, and what gets bootstrapped below.
    from app.api.sales_flow.crud import sales_flows_crud
    from app.api.sales_flow.schemas import SalesFlowType

    default_flow = sales_flows_crud.get_default_flow(db, popup.id)
    if default_flow is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Popup was created without a default sales flow",
        )

    # A door that sells directly skips the application-centric bootstrap (no
    # approval strategy, no form sections, no base field configs). Only
    # ticketing steps are seeded, so there is always something to sell.
    if default_flow.type == SalesFlowType.application.value:
        _seed_application_defaults(db, popup)
    seed_ticketing_steps_for_popup(
        db,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sales_flow_id=default_flow.id,
        flow_type=default_flow.type,
    )

    return PopupAdmin.model_validate(popup)


@router.patch("/{popup_id}", response_model=PopupAdmin)
async def update_popup(
    popup_id: uuid.UUID,
    popup_in: PopupUpdate,
    db: TenantSession,
    _current_user: CurrentOperator,
) -> PopupAdmin:
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
                status_code=status.HTTP_409_CONFLICT,
                detail="A popup with this slug already exists in this tenant",
            )

    # Snapshot status before update for cache invalidation hook (ADR-2, cache event #4)
    old_status = popup.status

    # `sale_type` is still accepted here, but it is a statement about the
    # DEFAULT FLOW's type. Nothing reads the popup column any more, so a change
    # that stopped at the column would be a change the product does not
    # honour: the form would show one thing and every buyer would get the
    # other. Compared against the flow, and applied to it below.
    door_to_retype = None
    if popup_in.sale_type is not None:
        current_door = _default_flow_or_500(db, popup.id)
        if popup_in.sale_type != current_door.type:
            approved_payments, _ = payments_crud.find_by_popup(
                db,
                popup.id,
                status_filter=PaymentStatus.APPROVED,
                limit=1,
            )
            if approved_payments:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "The main way into this event cannot change "
                        "after an approved payment exists"
                    ),
                )
            door_to_retype = current_door

    # Detect feature flags being enabled for the first time
    scholarship_enabling = (
        popup_in.allows_scholarship is True and not popup.allows_scholarship
    )

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: any per-URL failure keeps the original URL.
    _svc = ImageIngestionService()
    if popup_in.image_url is not None:
        popup_in.image_url = await _svc.ingest_url(popup_in.image_url, popup.tenant_id)
    if popup_in.icon_url is not None:
        popup_in.icon_url = await _svc.ingest_url(popup_in.icon_url, popup.tenant_id)
    if popup_in.favicon_url is not None:
        popup_in.favicon_url = await _svc.ingest_url(
            popup_in.favicon_url, popup.tenant_id
        )
    if popup_in.express_checkout_background is not None:
        popup_in.express_checkout_background = await _svc.ingest_url(
            popup_in.express_checkout_background, popup.tenant_id
        )

    try:
        updated = crud.update(db, popup, popup_in)
    except IntegrityError as exc:
        db.rollback()
        if "uq_popups_tenant_slug" in str(getattr(exc, "orig", exc)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A popup with this slug already exists in this tenant",
            )
        raise

    if door_to_retype is not None:
        # The name follows the type while it is still the one we gave it. A
        # door the organiser named themselves keeps their name.
        if door_to_retype.name == default_flow_name(door_to_retype.type):
            door_to_retype.name = default_flow_name(popup_in.sale_type)
        door_to_retype.type = popup_in.sale_type
        db.add(door_to_retype)
        db.commit()

    if popup_takes_applications(db, updated.id):
        _seed_application_defaults(db, updated)

    # Create gated sections and base field configs on first enable.
    # Section and config creation are both idempotent: re-enabling a flag
    # reuses any row left over from a previous enable cycle. Both belong to
    # the popup's default flow — a form row has no other place to live
    # (sdd/sales-flows-rediseno slice 3) — so the flow is resolved lazily,
    # only when a row is actually about to be written. A PATCH that touches
    # nothing form-related must not depend on it.
    default_flow = None

    section_map: dict[str, uuid.UUID] = {}
    for key, should_create in [
        ("scholarship", scholarship_enabling),
    ]:
        if not should_create:
            continue
        section_def = DEFAULT_SECTIONS[key]
        existing_section = next(
            (
                s
                for s in updated.form_sections
                if s.kind == section_def["kind"] or s.label == section_def["label"]
            ),
            None,
        )
        if existing_section is not None:
            section_map[key] = existing_section.id
            continue
        if default_flow is None:
            default_flow = _default_flow_or_500(db, updated.id)
        section = FormSections(
            tenant_id=updated.tenant_id,
            popup_id=updated.id,
            sales_flow_id=default_flow.id,
            label=section_def["label"],
            order=section_def["order"],
            protected=True,
            kind=section_def["kind"],
        )
        db.add(section)
        db.commit()
        db.refresh(section)
        section_map[key] = section.id

    if section_map:
        if default_flow is None:
            default_flow = _default_flow_or_500(db, updated.id)
        base_field_configs_crud.create_defaults_for_popup(
            db,
            popup_id=updated.id,
            tenant_id=updated.tenant_id,
            sales_flow_id=default_flow.id,
            section_map=section_map,
        )

    # Cache invalidation hook — ADR-2 cache event #4.
    # Lazy-open the main-platform DB session only on status transition so other
    # popup PATCH calls don't carry a second connection.
    if popup_in.status is not None and popup_in.status != old_status:
        from sqlmodel import Session  # noqa: PLC0415

        from app.api.tenant.models import Tenants  # noqa: PLC0415
        from app.core.dependencies.users import engine as main_engine  # noqa: PLC0415
        from app.core.redis import domain_cache  # noqa: PLC0415

        with Session(main_engine) as main_db:
            tenant_row = main_db.get(Tenants, updated.tenant_id)
            if (
                tenant_row is not None
                and tenant_row.landing_mode == LandingMode.checkout
                and tenant_row.custom_domain
            ):
                domain_cache.invalidate(tenant_row.custom_domain)

    return PopupAdmin.model_validate(updated)


@router.delete("/{popup_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_popup(
    popup_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentOperator,
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
    current_human: CurrentHuman,
    token_payload: CallerToken,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> list[PopupPublic]:
    """List popups visible to the current human in the Portal.

    Active popups are visible to everyone in the tenant. Ended popups (recap
    mode) are visible only to humans who participated, resolved via the same
    access ladder used by the passes/events gates.
    """
    from app.api.application.crud import applications_crud  # noqa: PLC0415

    active_popups, _ = crud.find(db, status=PopupStatus.active, limit=100)
    ended_popups, _ = crud.find(db, status=PopupStatus.ended, limit=100)
    participated_ended = [
        p
        for p in ended_popups
        if applications_crud.resolve_popup_access(db, current_human.id, p.id).allowed
    ]
    popups = list(active_popups) + participated_ended

    # Popup-scoped API keys only ever see their own popup.
    if is_popup_scoped_api_key(token_payload):
        popups = [p for p in popups if p.id == token_payload.popup_id]

    lang = parse_accept_language(accept_language)
    if lang is None:
        return _with_flow_kinds(
            db, popups, [PopupPublic.model_validate(p) for p in popups]
        )

    popup_ids = [p.id for p in popups]
    translations_map = get_translations_bulk(db, "popup", popup_ids, lang)

    results = []
    for p in popups:
        data = PopupPublic.model_validate(p).model_dump()
        data = apply_translation_overlay(
            data, translations_map.get(p.id), TRANSLATABLE_FIELDS["popup"]
        )
        results.append(PopupPublic.model_validate(data))
    return _with_flow_kinds(db, popups, results)


@router.get("/portal/{slug}", response_model=PopupPublic)
async def get_portal_popup(
    slug: str,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    token_payload: CallerToken,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> PopupPublic:
    """Get a popup by slug (Portal). Ended popups are served only to participants."""
    from app.api.application.crud import applications_crud  # noqa: PLC0415

    popup = crud.get_by_slug(db, slug)

    if not popup or popup.status not in (PopupStatus.active, PopupStatus.ended):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Event not found",
        )
    ensure_api_key_popup(token_payload, popup.id)

    if popup.status == PopupStatus.ended:
        access = applications_crud.resolve_popup_access(db, current_human.id, popup.id)
        if not access.allowed:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Event not found",
            )

    model = PopupPublic.model_validate(popup)

    lang = parse_accept_language(accept_language)
    if lang is not None:
        translation = get_translations_for_entity(db, "popup", popup.id, lang)
        data = apply_translation_overlay(
            model.model_dump(), translation, TRANSLATABLE_FIELDS["popup"]
        )
        model = PopupPublic.model_validate(data)

    # Stamped after the overlay, so a round trip through model_dump cannot
    # quietly reset the flags to their defaults.
    return _with_flow_kinds(db, [popup], [model])[0]
