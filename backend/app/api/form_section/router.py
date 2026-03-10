import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.form_section import crud
from app.api.form_section.schemas import (
    FormSectionCreate,
    FormSectionPublic,
    FormSectionUpdate,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentUser, CurrentWriter, TenantSession

router = APIRouter(prefix="/form-sections", tags=["form-sections"])


@router.get("", response_model=ListModel[FormSectionPublic])
async def list_form_sections(
    db: TenantSession,
    _: CurrentUser,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[FormSectionPublic]:
    if popup_id:
        sections, total = crud.form_sections_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit
        )
    else:
        sections, total = crud.form_sections_crud.find(db, skip=skip, limit=limit)

    return ListModel[FormSectionPublic](
        results=[FormSectionPublic.model_validate(s) for s in sections],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{section_id}", response_model=FormSectionPublic)
async def get_form_section(
    section_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
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
    db: TenantSession,
    current_user: CurrentWriter,
) -> FormSectionPublic:
    if current_user.role == UserRole.SUPERADMIN:
        from app.api.popup.crud import popups_crud

        popup = popups_crud.get(db, section_in.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )
        tenant_id = popup.tenant_id
    else:
        tenant_id = current_user.tenant_id

    from app.api.form_section.models import FormSections

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
    db: TenantSession,
    _current_user: CurrentWriter,
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
    db: TenantSession,
    _current_user: CurrentWriter,
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

    crud.form_sections_crud.delete(db, section)
