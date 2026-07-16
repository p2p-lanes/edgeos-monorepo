import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.api.form_section import crud
from app.api.form_section.models import FormSections
from app.api.form_section.schemas import (
    FormSectionCreate,
    FormSectionKind,
    FormSectionPublic,
    FormSectionUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.translation.service import delete_translations_for_entity
from app.core.dependencies.users import (
    AdminOrApiKey_FormsRead,
    AdminOrApiKey_FormsWrite,
    AdminOrApiKeySession_FormsRead,
    AdminOrApiKeySession_FormsWrite,
)

router = APIRouter(prefix="/form-sections", tags=["form-sections"])


@router.get("", response_model=ListModel[FormSectionPublic])
async def list_form_sections(
    db: AdminOrApiKeySession_FormsRead,
    _: AdminOrApiKey_FormsRead,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[FormSectionPublic]:
    if popup_id:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        # Fetch all sections for the popup (small set) so the flag filter
        # runs before pagination — otherwise totals and pages are wrong.
        all_sections, _ = crud.form_sections_crud.find_by_popup(
            db, popup_id=popup_id, limit=None
        )
        # Gate special-kind sections by current popup flags so the backoffice
        # renders consistently with the portal after a flag is toggled off.
        filtered = [s for s in all_sections if _section_allowed_by_flags(s, popup)]
        total = len(filtered)
        sections = filtered[skip : skip + limit]
    else:
        sections, total = crud.form_sections_crud.find(db, skip=skip, limit=limit)

    return ListModel[FormSectionPublic](
        results=[FormSectionPublic.model_validate(s) for s in sections],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


def _section_allowed_by_flags(section: FormSections, popup: Any) -> bool:
    if section.kind == FormSectionKind.SCHOLARSHIP.value:
        return bool(popup.allows_scholarship)
    return True


@router.get("/{section_id}", response_model=FormSectionPublic)
async def get_form_section(
    section_id: uuid.UUID,
    db: AdminOrApiKeySession_FormsRead,
    _: AdminOrApiKey_FormsRead,
) -> FormSectionPublic:
    section = crud.form_sections_crud.get(db, section_id)

    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form section not found",
        )

    return FormSectionPublic.model_validate(section)


@router.post("", response_model=FormSectionPublic, status_code=status.HTTP_201_CREATED)
async def create_form_section(
    section_in: FormSectionCreate,
    db: AdminOrApiKeySession_FormsWrite,
    current_user: AdminOrApiKey_FormsWrite,
) -> FormSectionPublic:
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, section_in.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    if current_user.role == UserRole.SUPERADMIN:
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    # Gate special-kind sections by popup feature flags and uniqueness.
    if section_in.kind != FormSectionKind.STANDARD:
        if (
            section_in.kind == FormSectionKind.SCHOLARSHIP
            and not popup.allows_scholarship
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Popup does not allow scholarship",
            )

        existing = db.exec(
            select(FormSections).where(
                FormSections.popup_id == section_in.popup_id,
                FormSections.kind == section_in.kind.value,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A section of kind '{section_in.kind.value}' already exists for this popup",
            )

    section_data = section_in.model_dump()
    section_data["tenant_id"] = tenant_id
    section = FormSections(**section_data)

    db.add(section)
    db.commit()
    db.refresh(section)

    return FormSectionPublic.model_validate(section)


@router.patch("/{section_id}", response_model=FormSectionPublic)
async def update_form_section(
    section_id: uuid.UUID,
    section_in: FormSectionUpdate,
    db: AdminOrApiKeySession_FormsWrite,
    _current_user: AdminOrApiKey_FormsWrite,
) -> FormSectionPublic:
    section = crud.form_sections_crud.get(db, section_id)

    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form section not found",
        )

    updated = crud.form_sections_crud.update(db, section, section_in)
    return FormSectionPublic.model_validate(updated)


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_form_section(
    section_id: uuid.UUID,
    db: AdminOrApiKeySession_FormsWrite,
    _current_user: AdminOrApiKey_FormsWrite,
) -> None:
    section = crud.form_sections_crud.get(db, section_id)

    if not section:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Form section not found",
        )

    if section.protected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a protected section",
        )

    delete_translations_for_entity(db, "form_section", section.id)
    crud.form_sections_crud.delete(db, section)
