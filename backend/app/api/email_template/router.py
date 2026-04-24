import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import text

from app.api.email_template import crud
from app.api.email_template.schemas import (
    EmailTemplateCreate,
    EmailTemplatePublic,
    EmailTemplateType,
    EmailTemplateUpdate,
    TemplateScope,
)
from app.api.shared.enums import UserRole
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentUser, CurrentWriter, TenantSession

router = APIRouter(prefix="/email-templates", tags=["email-templates"])


class TemplateVariable(BaseModel):
    name: str
    label: str | None = None
    type: str
    description: str
    required: bool = True
    group: str | None = None


class TemplateTypeInfo(BaseModel):
    type: str
    label: str
    description: str
    category: str
    scope: TemplateScope
    default_subject: str
    variables: list[TemplateVariable]


class PreviewRequest(BaseModel):
    html_content: str
    template_type: str
    subject: str | None = None
    preview_variables: dict[str, Any] | None = None
    popup_id: uuid.UUID | None = None


class PreviewResponse(BaseModel):
    rendered_html: str
    rendered_subject: str | None = None


class SendTestRequest(BaseModel):
    html_content: str
    template_type: str
    subject: str | None = None
    to_email: EmailStr
    custom_variables: dict[str, Any] | None = None
    popup_id: uuid.UUID | None = None


def _resolve_effective_tenant_id(current_user: CurrentUser, db: TenantSession) -> uuid.UUID:
    if current_user.tenant_id:
        return current_user.tenant_id

    tenant_id = db.connection().execute(
        text("SELECT current_setting('app.tenant_id', true)")
    ).scalar_one_or_none()
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve tenant context",
        )

    return uuid.UUID(tenant_id)


def _get_template_label(template_type: str) -> str | None:
    from app.services.email.templates import TEMPLATE_TYPE_METADATA

    metadata = next(
        (
            meta
            for meta in TEMPLATE_TYPE_METADATA
            if str(meta["type"]) == template_type
        ),
        None,
    )
    return metadata["label"] if metadata else None


def _template_scope_required_message(template_type: str) -> str:
    template_label = _get_template_label(template_type) or "email template"
    return f"Select a popup before managing the {template_label} template"


def _template_not_customizable_message(template_type: str) -> str:
    template_label = _get_template_label(template_type)
    if template_label:
        return f"{template_label} can't be customized from backoffice"
    return "This email template can't be customized from backoffice"


def _duplicate_template_message(
    template_type: str, template_scope: TemplateScope
) -> str:
    template_label = _get_template_label(template_type) or "email"
    scope_label = "workspace" if template_scope == TemplateScope.TENANT else "popup"
    return (
        f"This {scope_label} already has a custom {template_label} template. "
        "Open it from the list to edit it."
    )


@router.get("/types", response_model=list[TemplateTypeInfo])
async def list_template_types(
    _: CurrentUser,
) -> list[TemplateTypeInfo]:
    from app.services.email.templates import TEMPLATE_TYPE_METADATA

    return [TemplateTypeInfo(**meta) for meta in TEMPLATE_TYPE_METADATA]


@router.get("/default/{template_type}")
async def get_default_template(
    template_type: EmailTemplateType,
    _: CurrentUser,
) -> dict[str, str]:
    from app.services.email.templates import flatten_template

    html = flatten_template(template_type)
    return {"html_content": html}


@router.post("/preview", response_model=PreviewResponse)
async def preview_template(
    body: PreviewRequest,
    _: CurrentUser,
    db: TenantSession,
) -> PreviewResponse:
    from app.services.email.templates import (
        get_template_scope,
        is_customizable_template_type,
    )

    try:
        EmailTemplateType(body.template_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid template type: {body.template_type}",
        )

    if not is_customizable_template_type(body.template_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_template_not_customizable_message(body.template_type),
        )

    if get_template_scope(body.template_type) == TemplateScope.POPUP and not body.popup_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_template_scope_required_message(body.template_type),
        )

    # Start with enriched popup data as the base, then let preview_variables override
    variables: dict[str, Any] = {}
    if body.popup_id:
        from app.services.email.service import _enrich_with_popup_data

        variables = _enrich_with_popup_data(variables, body.popup_id, db)

    if body.preview_variables:
        variables.update(body.preview_variables)

    from app.services.email.service import get_email_service

    service = get_email_service()

    try:
        rendered_html = service.render_preview_template(body.html_content, variables)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template rendering error: {e}",
        )

    rendered_subject = None
    if body.subject:
        from jinja2.sandbox import SandboxedEnvironment

        from app.services.email.templates import PreservingUndefined

        env = SandboxedEnvironment(undefined=PreservingUndefined)
        rendered_subject = env.from_string(body.subject).render(**variables)

    return PreviewResponse(
        rendered_html=rendered_html, rendered_subject=rendered_subject
    )


@router.post("/send-test", status_code=status.HTTP_200_OK)
async def send_test_email(
    body: SendTestRequest,
    _: CurrentWriter,
    db: TenantSession,
) -> dict[str, str]:
    from app.services.email.templates import (
        get_template_scope,
        is_customizable_template_type,
    )

    try:
        EmailTemplateType(body.template_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid template type: {body.template_type}",
        )

    if not is_customizable_template_type(body.template_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_template_not_customizable_message(body.template_type),
        )

    if get_template_scope(body.template_type) == TemplateScope.POPUP and not body.popup_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_template_scope_required_message(body.template_type),
        )

    # Start with enriched popup data as the base, then let custom_variables override
    variables: dict[str, Any] = {}
    if body.popup_id:
        from app.services.email.service import _enrich_with_popup_data

        variables = _enrich_with_popup_data(variables, body.popup_id, db)

    if body.custom_variables:
        variables.update(body.custom_variables)

    from app.services.email.service import get_email_service

    service = get_email_service()

    try:
        rendered_html = service.render_preview_template(body.html_content, variables)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template rendering error: {e}",
        )

    rendered_subject = body.subject or "Test Email"
    if body.subject:
        from jinja2.sandbox import SandboxedEnvironment

        from app.services.email.templates import PreservingUndefined

        env = SandboxedEnvironment(undefined=PreservingUndefined)
        rendered_subject = env.from_string(body.subject).render(**variables)

    success = await service.send_email(
        to=body.to_email,
        subject=f"[TEST] {rendered_subject}",
        html_content=rendered_html,
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send test email",
        )

    return {"message": f"Test email sent to {body.to_email}"}


@router.get("", response_model=ListModel[EmailTemplatePublic])
async def list_email_templates(
    db: TenantSession,
    current_user: CurrentUser,
    popup_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[EmailTemplatePublic]:
    if popup_id:
        templates, total = crud.email_template_crud.find_by_popup(
            db, popup_id=popup_id, skip=skip, limit=limit
        )
    else:
        tenant_id = _resolve_effective_tenant_id(current_user, db)
        templates, total = crud.email_template_crud.find_by_tenant_scope(
            db, tenant_id=tenant_id, skip=skip, limit=limit
        )

    return ListModel[EmailTemplatePublic](
        results=[EmailTemplatePublic.model_validate(t) for t in templates],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/{template_id}", response_model=EmailTemplatePublic)
async def get_email_template(
    template_id: uuid.UUID,
    db: TenantSession,
    _: CurrentUser,
) -> EmailTemplatePublic:
    template = crud.email_template_crud.get(db, template_id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email template not found",
        )

    return EmailTemplatePublic.model_validate(template)


@router.post(
    "", response_model=EmailTemplatePublic, status_code=status.HTTP_201_CREATED
)
async def create_email_template(
    template_in: EmailTemplateCreate,
    db: TenantSession,
    current_user: CurrentWriter,
) -> EmailTemplatePublic:
    from app.services.email.templates import (
        get_template_scope,
        is_customizable_template_type,
    )

    # Validate template_type
    try:
        EmailTemplateType(template_in.template_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid template type: {template_in.template_type}",
        )

    if not is_customizable_template_type(template_in.template_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_template_not_customizable_message(template_in.template_type),
        )

    template_scope = get_template_scope(template_in.template_type)

    if template_scope == TemplateScope.POPUP:
        if not template_in.popup_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_template_scope_required_message(template_in.template_type),
            )

        existing = crud.email_template_crud.get_by_popup_and_type(
            db, template_in.popup_id, template_in.template_type
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_duplicate_template_message(
                    template_in.template_type, TemplateScope.POPUP
                ),
            )

        if current_user.role == UserRole.SUPERADMIN:
            from app.api.popup.crud import popups_crud

            popup = popups_crud.get(db, template_in.popup_id)
            if not popup:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Popup not found",
                )
            tenant_id = popup.tenant_id
        else:
            tenant_id = current_user.tenant_id
    else:
        tenant_id = _resolve_effective_tenant_id(current_user, db)
        existing = crud.email_template_crud.get_by_tenant_and_type(
            db, tenant_id, template_in.template_type
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_duplicate_template_message(
                    template_in.template_type, TemplateScope.TENANT
                ),
            )

    from app.api.email_template.models import EmailTemplates

    template_data = template_in.model_dump()
    template_data["tenant_id"] = tenant_id
    if template_scope == TemplateScope.TENANT:
        template_data["popup_id"] = None
    template = EmailTemplates(**template_data)

    db.add(template)
    db.commit()
    db.refresh(template)

    return EmailTemplatePublic.model_validate(template)


@router.patch("/{template_id}", response_model=EmailTemplatePublic)
async def update_email_template(
    template_id: uuid.UUID,
    template_in: EmailTemplateUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> EmailTemplatePublic:
    template = crud.email_template_crud.get(db, template_id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email template not found",
        )

    updated = crud.email_template_crud.update(db, template, template_in)
    return EmailTemplatePublic.model_validate(updated)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_email_template(
    template_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    template = crud.email_template_crud.get(db, template_id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email template not found",
        )

    crud.email_template_crud.delete(db, template)
