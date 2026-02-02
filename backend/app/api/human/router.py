import uuid
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, status

from app.api.human import crud
from app.api.human.schemas import HumanPublic, HumanUpdate
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, Paging
from app.core.dependencies.users import CurrentHuman, CurrentUser, TenantSession

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic

router = APIRouter(prefix="/humans", tags=["humans"])


def _check_write_permission(current_user: "UserPublic") -> None:
    if current_user.role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer role does not have write access",
        )


@router.get("", response_model=ListModel[HumanPublic])
async def list_humans(
    db: TenantSession,
    _: CurrentUser,
    skip: int = 0,
    limit: int = 100,
) -> ListModel[HumanPublic]:
    humans, total = crud.find(db, skip=skip, limit=limit)

    return ListModel[HumanPublic](
        results=[HumanPublic.model_validate(h) for h in humans],
        paging=Paging(
            offset=skip,
            limit=limit,
            total=total,
        ),
    )


@router.get("/me", response_model=HumanPublic)
async def get_current_human_info(
    current_user: CurrentHuman,
) -> HumanPublic:
    return HumanPublic.model_validate(current_user)


@router.get("/{human_id}", response_model=HumanPublic)
async def get_human(
    human_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> HumanPublic:
    human = crud.get(db, human_id)

    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    return HumanPublic.model_validate(human)


@router.patch("/{human_id}", response_model=HumanPublic)
async def update_human(
    human_id: uuid.UUID,
    human_in: HumanUpdate,
    db: TenantSession,
    current_user: CurrentUser,
) -> HumanPublic:
    _check_write_permission(current_user)

    human = crud.get(db, human_id)

    if not human:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Human not found",
        )

    # Check if red_flag is being set to True
    is_being_flagged = human_in.red_flag is True and not human.red_flag

    updated = crud.update(db, human, human_in)

    # If human is being flagged, auto-reject all their IN_REVIEW applications
    if is_being_flagged:
        from app.api.application.crud import applications_crud
        from app.api.application.schemas import ApplicationStatus

        applications, _ = applications_crud.find_by_human(db, human_id)
        for app in applications:
            if app.status == ApplicationStatus.IN_REVIEW.value:
                app.status = ApplicationStatus.REJECTED.value
                db.add(app)
                applications_crud.create_snapshot(db, app, "auto_rejected")
        db.commit()

    return HumanPublic.model_validate(updated)
