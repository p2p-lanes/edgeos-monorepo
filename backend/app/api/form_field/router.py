import uuid
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status

from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.crud import base_field_configs_crud
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.base_field_config.schemas import BaseFieldConfigUpdate
from app.api.form_field import crud

if TYPE_CHECKING:
    from sqlmodel import Session
from app.api.form_field.models import FormFields
from app.api.form_field.schemas import FormFieldCreate, FormFieldPublic, FormFieldUpdate
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.translation.service import delete_translations_for_entity
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentUser,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)

router = APIRouter(prefix="/form-fields", tags=["form-fields"])


def _to_public(field: FormFields) -> FormFieldPublic:
    """Convert a FormFields model to a FormFieldPublic with section_label."""
    data = FormFieldPublic.model_validate(field)
    data.section_label = field.section.label if field.section else None
    return data


def _base_config_to_public(config: BaseFieldConfigs) -> FormFieldPublic:
    """Convert a BaseFieldConfigs model to a FormFieldPublic."""
    definition = BASE_FIELD_DEFINITIONS[config.field_name]
    section_label = config.section.label if config.section else None
    return FormFieldPublic(
        id=config.id,
        tenant_id=config.tenant_id,
        popup_id=config.popup_id,
        name=config.field_name,
        label=(config.label.strip() if config.label else "") or definition["label"],
        field_type=definition["type"],
        section_id=config.section_id,
        section_label=section_label,
        position=config.position,
        required=definition["required"],
        options=config.options or definition.get("default_options"),
        placeholder=config.placeholder or definition.get("default_placeholder"),
        help_text=config.help_text or definition.get("default_help_text"),
        protected=True,
        target=definition["target"],
    )


def _get_base_fields_as_public(
    db: "Session", popup_id: uuid.UUID
) -> list[FormFieldPublic]:
    """Build FormFieldPublic entries from existing BaseFieldConfigs only."""
    configs = base_field_configs_crud.find_by_popup(db, popup_id)
    return [_base_config_to_public(c) for c in configs]


@router.get("", response_model=ListModel[FormFieldPublic])
async def list_form_fields(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[FormFieldPublic]:
    if popup_id:
        base_fields = _get_base_fields_as_public(db, popup_id)
        custom_fields, custom_total = crud.form_fields_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search
        )
        all_fields = base_fields + [_to_public(f) for f in custom_fields]
        # Sort by position
        all_fields.sort(key=lambda f: (f.position or 0))
        total = len(base_fields) + custom_total
    else:
        custom_fields, total = crud.form_fields_crud.find(
            db, skip=skip, limit=limit, search=search, search_fields=["label", "name"]
        )
        all_fields = [_to_public(f) for f in custom_fields]

    return ListModel[FormFieldPublic](
        results=all_fields,
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{field_id}", response_model=FormFieldPublic)
async def get_form_field(
    field_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> FormFieldPublic:
    field = crud.form_fields_crud.get(db, field_id)

    if field:
        return _to_public(field)

    # Check if it's a base field config
    base_config = base_field_configs_crud.get(db, field_id)
    if base_config:
        return _base_config_to_public(base_config)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Form field not found",
    )


@router.post("", response_model=FormFieldPublic, status_code=status.HTTP_201_CREATED)
async def create_form_field(
    field_in: FormFieldCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> FormFieldPublic:
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, field_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Auto-generate the internal field name from label
    name = crud.form_fields_crud.generate_field_name(
        db, field_in.label, field_in.popup_id
    )

    field_data = field_in.model_dump()
    field_data["tenant_id"] = tenant_id
    field_data["name"] = name
    field = FormFields(**field_data)

    db.add(field)
    db.commit()
    db.refresh(field)

    return _to_public(field)


@router.patch("/{field_id}", response_model=FormFieldPublic)
async def update_form_field(
    field_id: uuid.UUID,
    field_in: FormFieldUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> FormFieldPublic:
    field = crud.form_fields_crud.get(db, field_id)

    if field:
        # NOTE: field.name is a stable internal key generated once at creation.
        # It MUST NOT change when the label is edited — existing application
        # custom_fields reference this key and renaming it would silently break
        # the link to all previously submitted data.
        updated = crud.form_fields_crud.update(db, field, field_in)
        return _to_public(updated)

    # Check if it's a base field config
    base_config = base_field_configs_crud.get(db, field_id)
    if base_config:
        # Only forward fields that were actually sent and are configurable
        configurable = {
            "section_id",
            "position",
            "label",
            "placeholder",
            "help_text",
            "options",
        }
        update_data = {
            k: getattr(field_in, k) for k in field_in.model_fields_set & configurable
        }
        config_update = BaseFieldConfigUpdate(**update_data)
        updated_config = base_field_configs_crud.update(db, base_config, config_update)
        return _base_config_to_public(updated_config)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Form field not found",
    )


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_form_field(
    field_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    field = crud.form_fields_crud.get(db, field_id)

    if not field:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form field not found",
        )

    delete_translations_for_entity(db, "form_field", field.id)
    crud.form_fields_crud.delete(db, field)


@router.get("/schema/{popup_id}", response_model=dict[str, Any])
async def get_application_schema(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> dict[str, Any]:
    """Get the complete application schema for a popup.

    Returns a schema combining base application fields with
    custom form fields defined for the popup.
    """
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    return crud.form_fields_crud.build_schema_for_popup(db, popup_id)


@router.get("/portal/schema/{popup_id}", response_model=dict[str, Any])
async def get_portal_application_schema(
    popup_id: uuid.UUID,
    db: HumanTenantSession,
    _: CurrentHuman,
    accept_language: Annotated[str | None, Header(alias="Accept-Language")] = None,
) -> dict[str, Any]:
    """Get the application form schema for a popup (Portal)."""
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    schema = crud.form_fields_crud.build_schema_for_popup(db, popup_id)

    lang = None
    if accept_language and accept_language != "en":
        lang = accept_language.split(",")[0].split("-")[0].strip()

    if lang:
        from app.api.translation.service import (
            TRANSLATABLE_FIELDS,
            get_translations_bulk,
        )

        # Translate custom fields
        fields, _ = crud.form_fields_crud.find_by_popup(
            db, popup_id, skip=0, limit=1000
        )
        field_ids = [f.id for f in fields]
        field_translations = get_translations_bulk(db, "form_field", field_ids, lang)

        for field in fields:
            if field.id in field_translations:
                t_data = field_translations[field.id]
                entry = schema["custom_fields"].get(field.name)
                if entry:
                    for key in TRANSLATABLE_FIELDS["form_field"]:
                        if key in t_data:
                            entry[key] = t_data[key]

        # Translate sections
        section_ids = [uuid.UUID(s["id"]) for s in schema["sections"]]
        section_translations = get_translations_bulk(
            db, "form_section", section_ids, lang
        )

        for section in schema["sections"]:
            sid = uuid.UUID(section["id"])
            if sid in section_translations:
                t_data = section_translations[sid]
                for key in TRANSLATABLE_FIELDS["form_section"]:
                    if key in t_data:
                        section[key] = t_data[key]

    return schema
