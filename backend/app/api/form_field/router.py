import uuid
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Header, HTTPException, status

from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.crud import (
    base_field_configs_crud,
    field_applies_to_popup,
)
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.base_field_config.schemas import BaseFieldConfigUpdate, CatalogField
from app.api.form_field import crud

if TYPE_CHECKING:
    from sqlmodel import Session

    from app.api.popup.models import Popups
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
        label=config.label or "",
        field_type=definition["type"],
        section_id=config.section_id,
        section_label=section_label,
        position=config.position,
        required=config.required,
        options=config.options,
        placeholder=config.placeholder,
        help_text=config.help_text,
        protected=True,
        removable=definition.get("removable", True),
        target=definition["target"],
    )


def _get_base_fields_as_public(db: "Session", popup: "Popups") -> list[FormFieldPublic]:
    """Build FormFieldPublic entries from existing BaseFieldConfigs, filtered
    by the popup's current feature flags."""
    configs = base_field_configs_crud.find_by_popup(db, popup.id)
    return [
        _base_config_to_public(c)
        for c in configs
        if field_applies_to_popup(c.field_name, popup)
    ]


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
        from app.api.form_section.crud import form_sections_crud
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        base_fields = _get_base_fields_as_public(db, popup)
        custom_fields, custom_total = crud.form_fields_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit, search=search
        )
        all_fields = base_fields + [_to_public(f) for f in custom_fields]
        # Sort by (section.order, position) so fields group by section and
        # appear in their configured order. Sorting by position alone
        # interleaves fields across sections (e.g. a position=0 field from
        # section 2 lands between position=0 and position=1 of section 1).
        sections, _section_total = form_sections_crud.find_by_popup(
            db, popup_id, skip=0, limit=1000
        )
        # Unsectioned fields (section_id is None) sort last by using +inf.
        section_order_by_id: dict[uuid.UUID, int] = {
            s.id: s.order for s in sections
        }
        all_fields.sort(
            key=lambda f: (
                section_order_by_id.get(f.section_id, float("inf"))
                if f.section_id
                else float("inf"),
                f.position or 0,
            )
        )
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


@router.get("/catalog/{popup_id}", response_model=list[CatalogField])
async def list_available_base_fields(
    popup_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> list[CatalogField]:
    """List catalog base fields that are not yet configured for this popup.

    Filters out fields already configured, non-removable elementals, and
    fields disabled by the popup's feature flags.
    """
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    configured = {
        c.field_name for c in base_field_configs_crud.find_by_popup(db, popup_id)
    }

    available: list[CatalogField] = []
    for field_name, definition in BASE_FIELD_DEFINITIONS.items():
        if field_name in configured:
            continue
        if not definition.get("removable", True):
            # Elementals must always be present — they're seeded and not
            # offered in the "add field" catalog.
            continue
        if not field_applies_to_popup(field_name, popup):
            continue
        available.append(
            CatalogField(
                field_name=field_name,
                type=definition["type"],
                label=definition["label"],
                required=definition.get("required", False),
                target=definition["target"],
                default_section_key=definition.get("default_section_key"),
            )
        )

    return available


@router.post(
    "/catalog/{popup_id}/{field_name}",
    response_model=FormFieldPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_base_field_config(
    popup_id: uuid.UUID,
    field_name: str,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> FormFieldPublic:
    """Add a catalog base field to a popup by creating its BaseFieldConfig."""
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    definition = BASE_FIELD_DEFINITIONS.get(field_name)
    if not definition:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Field '{field_name}' is not in the catalog",
        )

    if not field_applies_to_popup(field_name, popup):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Popup does not allow field '{field_name}'",
        )

    existing = next(
        (
            c
            for c in base_field_configs_crud.find_by_popup(db, popup_id)
            if c.field_name == field_name
        ),
        None,
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Field '{field_name}' is already configured for this popup",
        )

    # Resolve default section by key if present.
    section_id: uuid.UUID | None = None
    default_section_key = definition.get("default_section_key")
    if default_section_key:
        from sqlmodel import select

        from app.api.form_section.models import FormSections

        stmt = select(FormSections).where(
            FormSections.popup_id == popup_id,
        )
        sections = db.exec(stmt).all()
        # Match by DEFAULT_SECTIONS label (seeded sections share the catalog label).
        from app.api.base_field_config.constants import DEFAULT_SECTIONS

        target_label = DEFAULT_SECTIONS.get(default_section_key, {}).get("label")
        if target_label:
            for s in sections:
                if s.label == target_label:
                    section_id = s.id
                    break

    config = BaseFieldConfigs(
        tenant_id=popup.tenant_id,
        popup_id=popup_id,
        field_name=field_name,
        section_id=section_id,
        position=definition.get("default_position", 0),
        required=definition.get("required", False),
        label=definition.get("label"),
        placeholder=definition.get("default_placeholder"),
        help_text=definition.get("default_help_text"),
        options=definition.get("default_options"),
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return _base_config_to_public(config)


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
            "required",
            "placeholder",
            "help_text",
            "options",
        }
        update_data = {
            k: getattr(field_in, k) for k in field_in.model_fields_set & configurable
        }

        # Non-removable elementals (first_name, last_name) cannot be made optional.
        definition = BASE_FIELD_DEFINITIONS.get(base_config.field_name, {})
        if (
            not definition.get("removable", True)
            and "required" in update_data
            and update_data["required"] is False
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{base_config.field_name}' is required and cannot be made optional",
            )

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

    if field:
        delete_translations_for_entity(db, "form_field", field.id)
        crud.form_fields_crud.delete(db, field)
        return

    # Fall back to BaseFieldConfig — removing it means the popup no longer
    # asks that base field.
    base_config = base_field_configs_crud.get(db, field_id)
    if not base_config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form field not found",
        )

    definition = BASE_FIELD_DEFINITIONS.get(base_config.field_name, {})
    if not definition.get("removable", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Field '{base_config.field_name}' cannot be removed",
        )

    delete_translations_for_entity(db, "form_field", base_config.id)
    base_field_configs_crud.delete(db, base_config)


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
