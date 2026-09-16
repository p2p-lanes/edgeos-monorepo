import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import delete, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, select

from app.api.ai_execution.models import AIExecutions

EXECUTION_TTL = timedelta(hours=1)


def execution_key(tool_call_id: str) -> str:
    """Build a bounded identifier without storing model-controlled text."""
    return hashlib.sha256(tool_call_id.encode()).hexdigest()


def _store_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Durable AI write protection is unavailable",
    )


def claim_execution(
    db: Session,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    tool_call_id: str,
    fingerprint: str,
) -> tuple[str, Any]:
    """Atomically claim an approved write or return its durable prior state."""
    now = datetime.now(UTC)
    expires_at = now + EXECUTION_TTL
    execution_id = execution_key(tool_call_id)
    table = AIExecutions.__table__

    try:
        # Keep the table bounded without a separate cleanup service. RLS limits
        # this cleanup to the active tenant, and the owner predicate keeps each
        # request's work proportional to that operator's execution history.
        db.exec(
            delete(AIExecutions).where(
                AIExecutions.owner_user_id == user_id,
                AIExecutions.expires_at <= now,
            )
        )
        inserted = db.exec(
            insert(table)
            .values(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                owner_user_id=user_id,
                execution_id=execution_id,
                fingerprint=fingerprint,
                state="pending",
                result=None,
                created_at=now,
                updated_at=now,
                expires_at=expires_at,
            )
            .on_conflict_do_nothing(constraint="uq_ai_executions_owner_execution")
            .returning(table.c.id)
        ).first()
        if inserted is not None:
            db.commit()
            return "acquired", None

        record = db.exec(
            select(AIExecutions).where(
                AIExecutions.tenant_id == tenant_id,
                AIExecutions.owner_user_id == user_id,
                AIExecutions.execution_id == execution_id,
            )
        ).first()
        if record is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Durable AI write protection is unavailable",
            )

        stored_fingerprint = record.fingerprint
        stored_state = record.state
        stored_result = record.result
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _store_unavailable() from exc

    if stored_fingerprint != fingerprint:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The approved operation payload cannot be changed",
        )
    if stored_state == "completed":
        return "completed", stored_result
    return "pending", None


def complete_execution(
    db: Session,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    tool_call_id: str,
    fingerprint: str,
    result: Any,
) -> None:
    """Persist the sanitized successful result for safe replay."""
    now = datetime.now(UTC)
    execution_id = execution_key(tool_call_id)
    table = AIExecutions.__table__

    try:
        stored = db.exec(
            update(table)
            .where(
                table.c.tenant_id == tenant_id,
                table.c.owner_user_id == user_id,
                table.c.execution_id == execution_id,
                table.c.fingerprint == fingerprint,
                table.c.expires_at > now,
            )
            .values(
                state="completed",
                result=result,
                updated_at=now,
                expires_at=now + EXECUTION_TTL,
            )
            .returning(table.c.id)
        ).first()
        if stored is None:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The AI execution claim is missing, expired, or changed",
            )
        db.commit()
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        # The claim was committed by the earlier request. If result persistence
        # is ambiguous, that pending claim remains and prevents another write.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The operation completed but its durable result could not be stored",
        ) from exc
