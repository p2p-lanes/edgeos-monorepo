import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.ticketing_step import crud
from app.api.ticketing_step.schemas import (
    TicketingStepCreate,
    TicketingStepPublic,
    TicketingStepUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentHuman, CurrentUser, CurrentWriter, HumanTenantSession, SessionDep, TenantSession

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
    db: TenantSession,
    _: CurrentUser,
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
    db: TenantSession,
    _: CurrentUser,
) -> TicketingStepPublic:
    step = crud.ticketing_steps_crud.get(db, step_id)

    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ticketing step not found",
        )

    return TicketingStepPublic.model_validate(step)


@router.post("", response_model=TicketingStepPublic, status_code=status.HTTP_201_CREATED)
async def create_ticketing_step(
    step_in: TicketingStepCreate,
    db: TenantSession,
    current_user: CurrentWriter,
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

    from app.api.ticketing_step.models import TicketingSteps

    step_data = step_in.model_dump()
    step_data["tenant_id"] = tenant_id
    step = TicketingSteps(**step_data)

    db.add(step)
    db.commit()
    db.refresh(step)

    return TicketingStepPublic.model_validate(step)


@router.patch("/{step_id}", response_model=TicketingStepPublic)
async def update_ticketing_step(
    step_id: uuid.UUID,
    step_in: TicketingStepUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
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

    updated = crud.ticketing_steps_crud.update(db, step, step_in)
    return TicketingStepPublic.model_validate(updated)


@router.delete("/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticketing_step(
    step_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
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
