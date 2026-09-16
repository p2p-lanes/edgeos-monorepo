import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

MAX_AI_CONVERSATIONS = 8
MAX_AI_MESSAGES = 40
MAX_AI_MESSAGE_PARTS = 100
MAX_AI_CONVERSATION_CHARS = 512_000
MAX_AI_TEXT_CHARS = 50_000
AI_CONVERSATION_RETENTION_DAYS = 30


class AIConversationUpsert(BaseModel):
    messages: list[dict[str, Any]] = Field(max_length=MAX_AI_MESSAGES)


class AIConversationUsageSummary(BaseModel):
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    models: list[str] = Field(default_factory=list)
    providers: list[str] = Field(default_factory=list)
    response_count: int = 0


class AIConversationPublic(BaseModel):
    id: uuid.UUID
    title: str
    messages: list[dict[str, Any]]
    schema_version: int
    revision: int
    created_at: datetime
    updated_at: datetime
    expires_at: datetime
    usage: AIConversationUsageSummary = Field(
        default_factory=AIConversationUsageSummary
    )

    model_config = ConfigDict(from_attributes=True)
