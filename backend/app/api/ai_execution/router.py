import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Path, status
from redis.client import Redis

from app.api.ai_execution.schemas import (
    AIExecutionClaimRequest,
    AIExecutionClaimResponse,
    AIExecutionCompleteRequest,
)
from app.api.ai_execution.service import (
    claim_execution,
    complete_execution,
    execution_key,
)
from app.api.shared.enums import UserRole
from app.core.dependencies.users import CurrentOperator, TenantSession
from app.core.redis import get_redis

router = APIRouter(prefix="/ai-executions", tags=["ai-executions"])
ToolCallId = Annotated[str, Path(pattern=r"^[0-9a-f]{64}$")]


def _tenant_id(current_user: CurrentOperator, x_tenant_id: str | None) -> uuid.UUID:
    if current_user.role == UserRole.SUPERADMIN:
        if not x_tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Tenant-Id header required for superadmin access",
            )
        try:
            return uuid.UUID(x_tenant_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            ) from exc
    if current_user.tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no tenant assigned",
        )
    if x_tenant_id and x_tenant_id != str(current_user.tenant_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid organization context",
        )
    return current_user.tenant_id


def _redis() -> Redis:
    client = get_redis()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Durable AI write protection is unavailable",
        )
    return client


@router.post(
    "/{tool_call_id}/claim",
    response_model=AIExecutionClaimResponse,
)
async def claim_ai_execution(
    tool_call_id: ToolCallId,
    request: AIExecutionClaimRequest,
    _: TenantSession,
    current_user: CurrentOperator,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> AIExecutionClaimResponse:
    """Claim one approved write across AI service replicas and restarts."""
    tenant_id = _tenant_id(current_user, x_tenant_id)
    state, result = claim_execution(
        _redis(),
        execution_key(tenant_id, current_user.id, tool_call_id),
        request.fingerprint,
    )
    return AIExecutionClaimResponse(state=state, result=result)


@router.post("/{tool_call_id}/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_ai_execution(
    tool_call_id: ToolCallId,
    request: AIExecutionCompleteRequest,
    _: TenantSession,
    current_user: CurrentOperator,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> None:
    """Persist a successful sanitized result so retries never repeat the write."""
    tenant_id = _tenant_id(current_user, x_tenant_id)
    complete_execution(
        _redis(),
        execution_key(tenant_id, current_user.id, tool_call_id),
        request.fingerprint,
        request.result,
    )
