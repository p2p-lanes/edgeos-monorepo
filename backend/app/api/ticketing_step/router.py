import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.ticketing_step import crud
from app.api.ticketing_step.schemas import (
    TicketingStepCreate,
    TicketingStepPublic,
    TicketingStepUpdate,
)
from app.core.dependencies.users import (
    AdminOrApiKey_TicketingStepsRead,
    AdminOrApiKey_TicketingStepsWrite,
    AdminOrApiKeySession_TicketingStepsRead,
    AdminOrApiKeySession_TicketingStepsWrite,
    CurrentHuman,
    HumanTenantSession,
)
from app.services.image_ingestion import ImageIngestionService

router = APIRouter(prefix="/ticketing-steps", tags=["ticketing-steps"])


@router.get("/portal", response_model=ListModel[TicketingStepPublic])
async def list_portal_ticketing_steps(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID,
) -> ListModel[TicketingStepPublic]:
    """List enabled ticketing steps for a popup (portal-facing)."""
    steps = crud.ticketing_steps_crud.find_portal_by_popup(db, popup_id=popup_id)
    return ListModel[TicketingStepPublic](
        results=[TicketingStepPublic.model_validate(s) for s in steps],
        paging=Paging(offset=0, limit=len(steps), total=len(steps)),
    )


@router.get("", response_model=ListModel[TicketingStepPublic])
async def list_ticketing_steps(
    db: AdminOrApiKeySession_TicketingStepsRead,
    _: AdminOrApiKey_TicketingStepsRead,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[TicketingStepPublic]:
    if popup_id:
        steps, total = crud.ticketing_steps_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit
        )
    else:
        steps, total = crud.ticketing_steps_crud.find(db, skip=skip, limit=limit)

    return ListModel[TicketingStepPublic](
        results=[TicketingStepPublic.model_validate(s) for s in steps],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{step_id}", response_model=TicketingStepPublic)
async def get_ticketing_step(
    step_id: uuid.UUID,
    db: AdminOrApiKeySession_TicketingStepsRead,
    _: AdminOrApiKey_TicketingStepsRead,
) -> TicketingStepPublic:
    step = crud.ticketing_steps_crud.get(db, step_id)

    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticketing step not found",
        )

    return TicketingStepPublic.model_validate(step)


def _validate_template_config_fk(
    template: str | None,
    template_config: dict | None,
    popup_id: uuid.UUID,
    db,
) -> None:
    """Validate that attendee_categories UUIDs in template_config sections exist in the popup.

    Pattern B (locked decision #1268): Pydantic validates UUID structure,
    router validates FK existence. This keeps schemas pure.
    """
    if template != "ticket-select" or not template_config:
        return
    sections = template_config.get("sections") or []
    from app.api.attendee_category.crud import attendee_categories_crud

    all_uuids: list[uuid.UUID] = []
    for section in sections:
        cats = section.get("attendee_categories")
        if cats:
            for cat in cats:
                if isinstance(cat, str):
                    try:
                        all_uuids.append(uuid.UUID(cat))
                    except ValueError:
                        raise HTTPException(
                            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Invalid UUID in attendee_categories: {cat}",
                        )
                elif isinstance(cat, uuid.UUID):
                    all_uuids.append(cat)

    if all_uuids and not attendee_categories_crud.exists_in_popup(
        db, all_uuids, popup_id
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=[
                {
                    "code": "invalid_attendee_category",
                    "message": "One or more attendee_categories UUIDs do not belong to this popup",
                }
            ],
        )


@router.post(
    "", response_model=TicketingStepPublic, status_code=status.HTTP_201_CREATED
)
async def create_ticketing_step(
    step_in: TicketingStepCreate,
    db: AdminOrApiKeySession_TicketingStepsWrite,
    current_user: AdminOrApiKey_TicketingStepsWrite,
) -> TicketingStepPublic:
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, step_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Singleton guard: only one enabled patron-preset step per popup.
    if step_in.template == "patron-preset" and step_in.is_enabled:
        crud.ticketing_steps_crud._assert_no_active_patron_preset(db, step_in.popup_id)

    # FK existence check for attendee_categories in template_config (Pattern B, ADR-5)
    _validate_template_config_fk(
        step_in.template, step_in.template_config, step_in.popup_id, db
    )

    step_data = step_in.model_dump()
    step_data["tenant_id"] = tenant_id

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook, mirrors _validate_template_config_fk precedent).
    # Fail-open: any per-URL failure keeps the original URL; the save still succeeds.
    _svc = ImageIngestionService()
    if step_data.get("template_config") is not None:
        step_data["template_config"] = await _svc.ingest_template_config(
            step_data.get("template"), step_data["template_config"], tenant_id
        )
    if step_data.get("watermark") is not None:
        step_data["watermark"] = await _svc.ingest_url(
            step_data["watermark"], tenant_id
        )

    from app.api.ticketing_step.models import TicketingSteps

    step = TicketingSteps(**step_data)

    db.add(step)
    db.commit()
    db.refresh(step)

    return TicketingStepPublic.model_validate(step)


@router.patch("/{step_id}", response_model=TicketingStepPublic)
async def update_ticketing_step(
    step_id: uuid.UUID,
    step_in: TicketingStepUpdate,
    db: AdminOrApiKeySession_TicketingStepsWrite,
    _current_user: AdminOrApiKey_TicketingStepsWrite,
) -> TicketingStepPublic:
    step = crud.ticketing_steps_crud.get(db, step_id)

    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticketing step not found",
        )

    # Cannot disable a protected step
    if step.protected and step_in.is_enabled is False:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot disable a protected step",
        )

    # FK existence check for attendee_categories in template_config (Pattern B, ADR-5)
    effective_template = step_in.template or step.template
    effective_config = (
        step_in.template_config if step_in.template_config is not None else None
    )
    if effective_config is not None:
        _validate_template_config_fk(
            effective_template, effective_config, step.popup_id, db
        )

    # CDN image ingestion: rewrite external image URLs to CDN before commit.
    # Pattern B (async hook). Fail-open: failures keep original URL; save succeeds.
    _svc = ImageIngestionService()
    if step_in.template_config is not None:
        step_in.template_config = await _svc.ingest_template_config(
            effective_template, step_in.template_config, step.tenant_id
        )
    if step_in.watermark is not None:
        step_in.watermark = await _svc.ingest_url(step_in.watermark, step.tenant_id)

    updated = crud.ticketing_steps_crud.update(db, step, step_in)
    return TicketingStepPublic.model_validate(updated)


@router.delete("/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticketing_step(
    step_id: uuid.UUID,
    db: AdminOrApiKeySession_TicketingStepsWrite,
    _current_user: AdminOrApiKey_TicketingStepsWrite,
) -> None:
    step = crud.ticketing_steps_crud.get(db, step_id)

    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticketing step not found",
        )

    if step.protected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a protected step",
        )

    crud.ticketing_steps_crud.delete(db, step)
