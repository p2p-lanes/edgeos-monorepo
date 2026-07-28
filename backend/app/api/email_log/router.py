"""Email log read API (backoffice, operator-and-above).

Operators own the email templates surface (CurrentOperator on template
mutations), so they can also see what was actually sent.
"""

import uuid

from fastapi import APIRouter

from app.api.email_log.crud import email_logs_crud
from app.api.email_log.schemas import EmailLogPublic
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentOperator, TenantSession

router = APIRouter(prefix="/email-logs", tags=["email-logs"])


@router.get("", response_model=ListModel[EmailLogPublic])
async def list_email_logs(
    db: TenantSession,
    _current_user: CurrentOperator,
    popup_id: uuid.UUID | None = None,
    template_type: str | None = None,
    status: str | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[EmailLogPublic]:
    """List dispatched emails, newest first.

    Filterable by popup/template type/status plus a free-text `search` over
    recipient and subject. Tenant scoping is enforced by RLS on the
    email_logs table, so cross-tenant rows are never returned.
    """
    rows, total = email_logs_crud.find(
        db,
        popup_id=popup_id,
        template_type=template_type,
        status=status,
        search=search,
        skip=skip,
        limit=limit,
    )
    return ListModel[EmailLogPublic](
        results=[EmailLogPublic.model_validate(r) for r in rows],
        paging=Paging(offset=skip, limit=limit, total=total),
    )
