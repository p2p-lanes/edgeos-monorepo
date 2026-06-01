"""CRUD for the audit log.

`record` is the single write primitive used at every mutation site. It does NOT
commit — it stages the row in the caller's session so the audit entry is written
atomically with the action it describes (a rolled-back action leaves no log).
"""

import uuid
from typing import Any

from sqlmodel import Session, col, func, select

from app.api.audit_log.models import AuditLog


class AuditLogsCRUD:
    """Read/write operations for audit_logs."""

    def record(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        actor_user_id: uuid.UUID | None,
        actor_label: str,
        action: str,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        entity_label: str | None = None,
        popup_id: uuid.UUID | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog:
        """Stage one audit entry in the caller's transaction (no commit)."""
        log = AuditLog(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            actor_label=actor_label,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            popup_id=popup_id,
            details=details,
        )
        session.add(log)
        return log

    def find(
        self,
        session: Session,
        *,
        popup_id: uuid.UUID | None = None,
        action: str | None = None,
        actor_user_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[AuditLog], int]:
        """Return a page of audit entries (newest first) plus the total count."""
        conditions = []
        if popup_id is not None:
            conditions.append(AuditLog.popup_id == popup_id)
        if action is not None:
            conditions.append(AuditLog.action == action)
        if actor_user_id is not None:
            conditions.append(AuditLog.actor_user_id == actor_user_id)
        if entity_type is not None:
            conditions.append(AuditLog.entity_type == entity_type)
        if entity_id is not None:
            conditions.append(AuditLog.entity_id == entity_id)

        total = session.exec(
            select(func.count()).select_from(AuditLog).where(*conditions)
        ).one()

        rows = session.exec(
            select(AuditLog)
            .where(*conditions)
            .order_by(col(AuditLog.created_at).desc())
            .offset(skip)
            .limit(limit)
        ).all()
        return list(rows), total


audit_logs_crud = AuditLogsCRUD()
