"""CRUD for the audit log.

`record` is the single write primitive used at every mutation site. It does NOT
commit — it stages the row in the caller's session so the audit entry is written
atomically with the action it describes (a rolled-back action leaves no log).
"""

import uuid
from typing import Any

from loguru import logger
from sqlmodel import Session, col, func, or_, select

from app.api.audit_log.actor import AuditActor
from app.api.audit_log.models import AuditLog
from app.core.logging import get_request_id


class AuditLogsCRUD:
    """Read/write operations for audit_logs."""

    def record(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        actor: AuditActor,
        action: str,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        entity_label: str | None = None,
        popup_id: uuid.UUID | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog:
        """Stage one audit entry in the caller's transaction (no commit).

        Atomic by design: the row is committed together with the action it
        describes. Use :meth:`record_best_effort` for broad instrumentation
        where an audit failure must never break the user-facing operation.
        """
        log = AuditLog(
            tenant_id=tenant_id,
            source=actor.source.value,
            actor_type=actor.type.value,
            actor_id=actor.id,
            actor_email=actor.email,
            actor_name=actor.name,
            request_id=get_request_id(),
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_label=entity_label,
            popup_id=popup_id,
            details=details,
        )
        session.add(log)
        return log

    def record_best_effort(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        actor: AuditActor,
        action: str,
        entity_type: str,
        entity_id: uuid.UUID | None = None,
        entity_label: str | None = None,
        popup_id: uuid.UUID | None = None,
        details: dict[str, Any] | None = None,
    ) -> AuditLog | None:
        """Record + commit an audit entry, swallowing any failure.

        For callers whose mutation has already committed (e.g. broad router
        instrumentation): an audit write must never surface an error to the
        user. Any exception is logged and the row is dropped.

        PRECONDITION: the session must be clean (the mutation already
        committed). This calls ``session.commit()``, which flushes ALL pending
        session state — so any uncommitted work staged before this call would be
        committed as a side effect. To tie an audit row to an uncommitted
        mutation atomically, use ``record`` (no commit) instead.
        """
        try:
            log = self.record(
                session,
                tenant_id=tenant_id,
                actor=actor,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                entity_label=entity_label,
                popup_id=popup_id,
                details=details,
            )
            session.commit()
            session.refresh(log)
            return log
        except Exception as exc:  # noqa: BLE001 — audit must never break the request
            session.rollback()
            logger.warning(
                "audit write failed (action={} entity={}/{}): {}",
                action,
                entity_type,
                entity_id,
                exc,
            )
            return None

    # Columns the global feed may sort by (maps the API sort_by key → column).
    _SORTABLE = {
        "created_at": "created_at",
        "actor": "actor_name",
        "action": "action",
    }

    def find(
        self,
        session: Session,
        *,
        popup_id: uuid.UUID | None = None,
        action: str | None = None,
        actor_id: uuid.UUID | None = None,
        entity_type: str | None = None,
        entity_id: uuid.UUID | None = None,
        source: str | None = None,
        search: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[AuditLog], int]:
        """Return a page of audit entries plus the total count.

        Filterable by popup/action/actor/entity/source and a free-text `search`
        over actor name/email and the entity label. Sortable by created_at
        (default), actor, or action; newest-first by default.
        """
        conditions = []
        if popup_id is not None:
            conditions.append(AuditLog.popup_id == popup_id)
        if action is not None:
            conditions.append(AuditLog.action == action)
        if actor_id is not None:
            conditions.append(AuditLog.actor_id == actor_id)
        if entity_type is not None:
            conditions.append(AuditLog.entity_type == entity_type)
        if entity_id is not None:
            conditions.append(AuditLog.entity_id == entity_id)
        if source is not None:
            conditions.append(AuditLog.source == source)
        if search:
            like = f"%{search.strip()}%"
            conditions.append(
                or_(
                    col(AuditLog.actor_name).ilike(like),
                    col(AuditLog.actor_email).ilike(like),
                    col(AuditLog.entity_label).ilike(like),
                    col(AuditLog.action).ilike(like),
                )
            )

        total = session.exec(
            select(func.count()).select_from(AuditLog).where(*conditions)
        ).one()

        sort_column = self._SORTABLE.get(sort_by or "created_at", "created_at")
        order_col = col(getattr(AuditLog, sort_column))
        order_by = order_col.asc() if sort_order == "asc" else order_col.desc()

        rows = session.exec(
            select(AuditLog)
            .where(*conditions)
            .order_by(order_by)
            .offset(skip)
            .limit(limit)
        ).all()
        return list(rows), total


audit_logs_crud = AuditLogsCRUD()
