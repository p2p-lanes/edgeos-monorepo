import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from sqlalchemy import delete
from sqlmodel import select

from app.api.ai_conversation.models import AIConversations, AIConversationUsage
from app.api.ai_conversation.schemas import (
    AI_CONVERSATION_RETENTION_DAYS,
    MAX_AI_CONVERSATIONS,
    AIConversationPublic,
    AIConversationUpsert,
    AIConversationUsageSummary,
)
from app.api.ai_conversation.service import (
    UsageEvent,
    conversation_title,
    sanitize_conversation_messages,
)
from app.api.shared.enums import UserRole
from app.core.dependencies.users import CurrentOperator, TenantSession

router = APIRouter(prefix="/ai-conversations", tags=["ai-conversations"])


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


def _owned_conversation(
    db: TenantSession,
    conversation_id: uuid.UUID,
    owner_user_id: uuid.UUID,
) -> AIConversations:
    conversation = db.get(AIConversations, conversation_id)
    if conversation is None or conversation.owner_user_id != owner_user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    return conversation


def _usage_summaries(
    db: TenantSession,
    conversation_ids: list[uuid.UUID],
) -> dict[uuid.UUID, AIConversationUsageSummary]:
    if not conversation_ids:
        return {}
    events = db.exec(
        select(AIConversationUsage).where(
            AIConversationUsage.conversation_id.in_(conversation_ids)  # type: ignore[union-attr]
        )
    ).all()
    totals: dict[uuid.UUID, dict] = defaultdict(
        lambda: {
            "input_tokens": 0,
            "cached_input_tokens": 0,
            "output_tokens": 0,
            "reasoning_tokens": 0,
            "models": set(),
            "providers": set(),
            "response_count": 0,
        }
    )
    for event in events:
        total = totals[event.conversation_id]
        total["input_tokens"] += event.input_tokens
        total["cached_input_tokens"] += event.cached_input_tokens
        total["output_tokens"] += event.output_tokens
        total["reasoning_tokens"] += event.reasoning_tokens
        total["models"].add(event.model)
        total["providers"].add(event.provider)
        total["response_count"] += 1
    return {
        conversation_id: AIConversationUsageSummary(
            **{
                **total,
                "models": sorted(total["models"]),
                "providers": sorted(total["providers"]),
            }
        )
        for conversation_id, total in totals.items()
    }


def _public_conversations(
    db: TenantSession,
    conversations: list[AIConversations],
) -> list[AIConversationPublic]:
    usage = _usage_summaries(db, [item.id for item in conversations])
    return [
        AIConversationPublic.model_validate(item).model_copy(
            update={"usage": usage.get(item.id, AIConversationUsageSummary())}
        )
        for item in conversations
    ]


def _store_usage_events(
    db: TenantSession,
    conversation: AIConversations,
    events: list[UsageEvent],
) -> None:
    if not events:
        return
    event_ids = [event.event_id for event in events]
    existing = set(
        db.exec(
            select(AIConversationUsage.event_id).where(
                AIConversationUsage.conversation_id == conversation.id,
                AIConversationUsage.event_id.in_(event_ids),  # type: ignore[union-attr]
            )
        ).all()
    )
    for event in events:
        if event.event_id in existing:
            continue
        db.add(
            AIConversationUsage(
                tenant_id=conversation.tenant_id,
                conversation_id=conversation.id,
                event_id=event.event_id,
                provider=event.provider,
                model=event.model,
                input_tokens=event.input_tokens,
                cached_input_tokens=event.cached_input_tokens,
                output_tokens=event.output_tokens,
                reasoning_tokens=event.reasoning_tokens,
            )
        )


def _delete_expired(db: TenantSession, owner_user_id: uuid.UUID) -> None:
    db.exec(
        delete(AIConversations).where(
            AIConversations.owner_user_id == owner_user_id,
            AIConversations.expires_at <= datetime.now(UTC),
        )
    )


@router.get("", response_model=list[AIConversationPublic])
async def list_ai_conversations(
    db: TenantSession,
    current_user: CurrentOperator,
) -> list[AIConversationPublic]:
    """List the current operator's non-expired conversations."""
    _delete_expired(db, current_user.id)
    db.commit()
    conversations = list(
        db.exec(
            select(AIConversations)
            .where(AIConversations.owner_user_id == current_user.id)
            .order_by(AIConversations.updated_at.desc())  # type: ignore[union-attr]
            .limit(MAX_AI_CONVERSATIONS)
        ).all()
    )
    return _public_conversations(db, conversations)


@router.get("/{conversation_id}", response_model=AIConversationPublic)
async def get_ai_conversation(
    conversation_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentOperator,
) -> AIConversationPublic:
    """Get one conversation owned by the current operator."""
    conversation = _owned_conversation(db, conversation_id, current_user.id)
    if conversation.expires_at <= datetime.now(UTC):
        db.delete(conversation)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    return _public_conversations(db, [conversation])[0]


@router.put("/{conversation_id}", response_model=AIConversationPublic)
async def upsert_ai_conversation(
    conversation_id: uuid.UUID,
    conversation_in: AIConversationUpsert,
    db: TenantSession,
    current_user: CurrentOperator,
    x_tenant_id: Annotated[str | None, Header(alias="X-Tenant-Id")] = None,
) -> AIConversationPublic:
    """Create or replace one sanitized conversation owned by the caller."""
    tenant_id = _tenant_id(current_user, x_tenant_id)
    messages, usage_events = sanitize_conversation_messages(conversation_in.messages)
    now = datetime.now(UTC)
    conversation = db.get(AIConversations, conversation_id)
    if conversation is not None and conversation.owner_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found",
        )
    if conversation is None:
        conversation = AIConversations(
            id=conversation_id,
            tenant_id=tenant_id,
            owner_user_id=current_user.id,
            title=conversation_title(messages),
            messages=messages,
            created_at=now,
            updated_at=now,
            expires_at=now + timedelta(days=AI_CONVERSATION_RETENTION_DAYS),
        )
    else:
        conversation.title = conversation_title(messages)
        conversation.messages = messages
        conversation.schema_version = 1
        conversation.revision += 1
        conversation.updated_at = now
        conversation.expires_at = now + timedelta(days=AI_CONVERSATION_RETENTION_DAYS)
    db.add(conversation)
    db.flush()
    _store_usage_events(db, conversation, usage_events)
    db.commit()
    db.refresh(conversation)

    older = db.exec(
        select(AIConversations)
        .where(AIConversations.owner_user_id == current_user.id)
        .order_by(AIConversations.updated_at.desc())  # type: ignore[union-attr]
        .offset(MAX_AI_CONVERSATIONS)
    ).all()
    if older:
        for item in older:
            db.delete(item)
        db.commit()
    return _public_conversations(db, [conversation])[0]


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_conversation(
    conversation_id: uuid.UUID,
    db: TenantSession,
    current_user: CurrentOperator,
) -> None:
    """Delete one conversation owned by the current operator."""
    conversation = _owned_conversation(db, conversation_id, current_user.id)
    db.delete(conversation)
    db.commit()
