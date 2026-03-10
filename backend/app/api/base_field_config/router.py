import uuid

from fastapi import APIRouter, HTTPException, Query, status

from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.schemas import (
    BaseFieldConfigPublic,
    BaseFieldConfigUpdate,
)
from app.core.dependencies.users import CurrentWriter, TenantSession

router = APIRouter(prefix="/base-field-configs", tags=["base-field-configs"])


@router.get("", response_model=list[BaseFieldConfigPublic])
async def list_base_field_configs(
    db: TenantSession,
    _: CurrentWriter,
    popup_id: uuid.UUID = Query(..., description="Filter by popup ID"),
) -> list[BaseFieldConfigPublic]:
    configs = base_field_configs_crud.find_by_popup(db, popup_id)
    return [BaseFieldConfigPublic.model_validate(c) for c in configs]


@router.patch("/{config_id}", response_model=BaseFieldConfigPublic)
async def update_base_field_config(
    config_id: uuid.UUID,
    config_in: BaseFieldConfigUpdate,
    db: TenantSession,
    _: CurrentWriter,
) -> BaseFieldConfigPublic:
    config = base_field_configs_crud.get(db, config_id)
    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Base field config not found",
        )

    updated = base_field_configs_crud.update(db, config, config_in)
    return BaseFieldConfigPublic.model_validate(updated)
