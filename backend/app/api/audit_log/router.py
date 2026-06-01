"""Audit log read API (backoffice, admin-only)."""

import uuid

from fastapi import APIRouter

from app.api.audit_log.crud import audit_logs_crud
from app.api.audit_log.schemas import AuditLogPublic
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.core.dependencies.users import CurrentAdmin, TenantSession

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])


@router.get("", response_model=ListModel[AuditLogPublic])
async def list_audit_logs(
    db: TenantSession,
    _current_user: CurrentAdmin,
    popup_id: uuid.UUID | None = None,
    action: str | None = None,
    actor_id: uuid.UUID | None = None,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[AuditLogPublic]:
    """List audit log entries (newest first), filterable for both surfaces.

    The per-attendee history passes `entity_id`; the global feed uses
    `popup_id` / `action` / `actor_id`. Tenant scoping is enforced by RLS
    on the audit_logs table, so cross-tenant rows are never returned.
    """
    rows, total = audit_logs_crud.find(
        db,
        popup_id=popup_id,
        action=action,
        actor_id=actor_id,
        entity_type=entity_type,
        entity_id=entity_id,
        skip=skip,
        limit=limit,
    )
    return ListModel[AuditLogPublic](
        results=[AuditLogPublic.model_validate(r) for r in rows],
        paging=Paging(offset=skip, limit=limit, total=total),
    )
