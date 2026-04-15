import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel

from app.api.shared.enums import UserRole
from app.api.translation.crud import translations_crud
from app.api.translation.schemas import TranslationCreate, TranslationPublic
from app.api.translation.service import TRANSLATABLE_FIELDS
from app.core.dependencies.users import CurrentUser, CurrentWriter, TenantSession

router = APIRouter(prefix="/translations", tags=["translations"])


@router.get("", response_model=list[TranslationPublic])
async def list_translations(
    entity_type: str,
    entity_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> list[TranslationPublic]:
    """List all translations for an entity."""
    translations = translations_crud.find_by_entity(db, entity_type, entity_id)
    return [TranslationPublic.model_validate(t) for t in translations]


@router.post("", response_model=TranslationPublic, status_code=status.HTTP_201_CREATED)
async def upsert_translation(
    translation_in: TranslationCreate,
    db: TenantSession,
    current_user: CurrentWriter,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> TranslationPublic:
    """Create or update a translation for an entity."""
    if translation_in.entity_type not in TRANSLATABLE_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid entity_type. Must be one of: {', '.join(TRANSLATABLE_FIELDS.keys())}",
        )

    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Superadmin must provide X-Tenant-Id header",
            )
        tenant_id = uuid.UUID(x_tenant_id)
    else:
        tenant_id = current_user.tenant_id

    translation = translations_crud.upsert(db, tenant_id, translation_in)
    return TranslationPublic.model_validate(translation)


class AITranslateRequest(BaseModel):
    entity_type: str
    entity_id: uuid.UUID
    target_language: str


@router.post("/ai-translate", response_model=dict[str, str])
async def ai_translate(
    request: AITranslateRequest,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> dict[str, str]:
    """Use AI to generate draft translations for an entity. Returns translated fields (not saved)."""
    if request.entity_type not in TRANSLATABLE_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid entity_type. Must be one of: {', '.join(TRANSLATABLE_FIELDS.keys())}",
        )

    entity = _fetch_entity(db, request.entity_type, request.entity_id)
    if not entity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{request.entity_type} not found",
        )

    translatable = TRANSLATABLE_FIELDS[request.entity_type]
    source_fields: dict[str, str] = {}
    for field in translatable:
        value = getattr(entity, field, None)
        if value and isinstance(value, str):
            source_fields[field] = value

    if not source_fields:
        return {}

    from app.services.ai_translation import translate_fields

    try:
        translated = await translate_fields(
            fields=source_fields,
            target_language=request.target_language,
            entity_type=request.entity_type,
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI translation failed: {e}",
        )

    return {k: v for k, v in translated.items() if k in translatable}


@router.delete("/{translation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_translation(
    translation_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> None:
    """Delete a translation."""
    translation = translations_crud.get(db, translation_id)

    if not translation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Translation not found",
        )

    translations_crud.delete(db, translation)


def _fetch_entity(db, entity_type: str, entity_id: uuid.UUID):
    """Fetch an entity by type and ID using the appropriate CRUD."""
    from app.api.form_field.crud import form_fields_crud
    from app.api.form_section.crud import form_sections_crud
    from app.api.group.crud import groups_crud
    from app.api.popup.crud import popups_crud
    from app.api.product.crud import products_crud

    cruds = {
        "popup": popups_crud,
        "product": products_crud,
        "group": groups_crud,
        "form_field": form_fields_crud,
        "form_section": form_sections_crud,
    }
    crud = cruds.get(entity_type)
    if not crud:
        return None
    return crud.get(db, entity_id)
