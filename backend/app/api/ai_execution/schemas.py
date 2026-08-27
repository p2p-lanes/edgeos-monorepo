from typing import Any, Literal

from pydantic import BaseModel, Field


class AIExecutionClaimRequest(BaseModel):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class AIExecutionClaimResponse(BaseModel):
    state: Literal["acquired", "pending", "completed"]
    result: Any = None


class AIExecutionCompleteRequest(BaseModel):
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    result: Any
