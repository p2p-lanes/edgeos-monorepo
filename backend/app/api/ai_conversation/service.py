import json
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status

from app.api.ai_conversation.schemas import (
    MAX_AI_CONVERSATION_CHARS,
    MAX_AI_MESSAGE_PARTS,
    MAX_AI_TEXT_CHARS,
)

_SENSITIVE_KEYS = {
    "authorization",
    "password",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "signature",
    "tool_approval_secret",
}
_ALLOWED_ROLES = {"user", "assistant"}
_ALLOWED_USAGE_PROVIDERS = {"openai", "google"}


@dataclass(frozen=True)
class UsageEvent:
    event_id: uuid.UUID
    provider: str
    model: str
    input_tokens: int
    cached_input_tokens: int
    output_tokens: int
    reasoning_tokens: int


def _validation_error(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=detail,
    )


def _safe_json(value: Any, depth: int = 0) -> Any:
    if depth > 12:
        return None
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, list):
        return [_safe_json(item, depth + 1) for item in value[:200]]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for raw_key, item in list(value.items())[:200]:
            key = str(raw_key)[:200]
            lowered = key.lower()
            if (
                lowered in _SENSITIVE_KEYS
                or lowered.endswith("_password")
                or lowered.endswith("_secret")
                or lowered.endswith("_token")
            ):
                continue
            result[key] = _safe_json(item, depth + 1)
        return result
    return None


def _short_string(value: Any, limit: int = 200) -> str | None:
    return value[:limit] if isinstance(value, str) else None


def _usage_event(message: dict[str, Any]) -> UsageEvent | None:
    metadata = message.get("metadata")
    if not isinstance(metadata, dict):
        return None
    usage = metadata.get("edgeosUsage")
    if not isinstance(usage, dict):
        return None
    try:
        event_id = uuid.UUID(str(usage.get("eventId")))
    except (TypeError, ValueError):
        return None
    provider = _short_string(usage.get("provider"), 32)
    model = _short_string(usage.get("model"), 120)
    if provider not in _ALLOWED_USAGE_PROVIDERS or not model:
        return None

    def token_count(name: str) -> int:
        value = usage.get(name)
        return (
            value
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0
            else 0
        )

    return UsageEvent(
        event_id=event_id,
        provider=provider,
        model=model,
        input_tokens=token_count("inputTokens"),
        cached_input_tokens=token_count("cachedInputTokens"),
        output_tokens=token_count("outputTokens"),
        reasoning_tokens=token_count("reasoningTokens"),
    )


def _expired_file_part(kind: str) -> dict[str, Any]:
    return {
        "type": "data-expired-prepared-file",
        "data": {"persistedState": "expired", "kind": kind},
    }


def _sanitize_tool_part(part: dict[str, Any]) -> dict[str, Any] | None:
    part_type = _short_string(part.get("type"))
    if part_type not in {
        "tool-searchOperations",
        "tool-prepareCustomExport",
        "tool-executeOperation",
    }:
        return None

    state = _short_string(part.get("state"), 40)
    output = part.get("output")
    if (
        part_type == "tool-prepareCustomExport"
        and state == "output-available"
        and isinstance(output, dict)
    ):
        return _expired_file_part("custom-export")
    if (
        part_type == "tool-executeOperation"
        and isinstance(output, dict)
        and isinstance(output.get("download"), dict)
    ):
        return _expired_file_part("download")

    sanitized: dict[str, Any] = {"type": part_type}
    tool_call_id = _short_string(part.get("toolCallId"))
    if tool_call_id:
        sanitized["toolCallId"] = tool_call_id
    if "input" in part:
        sanitized["input"] = _safe_json(part.get("input"))

    if state in {"approval-requested", "approval-responded"}:
        approval = part.get("approval")
        approval_id = (
            _short_string(approval.get("id")) if isinstance(approval, dict) else None
        )
        sanitized["state"] = "output-denied"
        if approval_id:
            sanitized["approval"] = {"id": approval_id, "approved": False}
        return sanitized

    complete_states = {
        "output-available",
        "output-error",
        "output-denied",
        "approval-responded",
    }
    if state not in complete_states:
        sanitized["state"] = "output-error"
        sanitized["errorText"] = "This action was interrupted before it completed."
        return sanitized

    sanitized["state"] = state
    approval = part.get("approval")
    if isinstance(approval, dict):
        approval_id = _short_string(approval.get("id"))
        if approval_id:
            sanitized["approval"] = {
                "id": approval_id,
                **(
                    {"approved": approval["approved"]}
                    if isinstance(approval.get("approved"), bool)
                    else {}
                ),
            }

    if state == "output-error":
        sanitized["errorText"] = (
            _short_string(part.get("errorText"), 1000) or "The action failed."
        )
        return sanitized

    if not isinstance(output, dict):
        return sanitized
    if part_type == "tool-searchOperations":
        operations = output.get("operations")
        count = len(operations) if isinstance(operations, list) else 0
        sanitized["output"] = {"resultCount": count}
        return sanitized
    if part_type == "tool-executeOperation":
        sanitized["output"] = {
            "operation": _safe_json(output.get("operation")),
            "status": output.get("status")
            if isinstance(output.get("status"), int)
            else None,
            "requestId": _short_string(output.get("requestId")),
            "context": _safe_json(output.get("context")),
            "data": {"persistedSummary": True}
            if output.get("data") is not None
            else None,
        }
        return sanitized
    return sanitized


def sanitize_conversation_messages(
    messages: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[UsageEvent]]:
    try:
        serialized_size = len(json.dumps(messages, separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise _validation_error("Conversation messages must be valid JSON.") from exc
    if serialized_size > MAX_AI_CONVERSATION_CHARS:
        raise _validation_error("This conversation is too large to save.")

    sanitized_messages: list[dict[str, Any]] = []
    usage_events: list[UsageEvent] = []
    for raw_message in messages:
        if not isinstance(raw_message, dict):
            raise _validation_error("Each conversation message must be an object.")
        role = raw_message.get("role")
        message_id = _short_string(raw_message.get("id"))
        parts = raw_message.get("parts")
        if role not in _ALLOWED_ROLES or not message_id or not isinstance(parts, list):
            raise _validation_error("Conversation message shape is invalid.")
        if len(parts) > MAX_AI_MESSAGE_PARTS:
            raise _validation_error("A conversation message has too many parts.")

        usage = _usage_event(raw_message)
        if usage:
            usage_events.append(usage)

        sanitized_parts: list[dict[str, Any]] = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            part_type = part.get("type")
            if part_type == "text" and isinstance(part.get("text"), str):
                sanitized_parts.append(
                    {"type": "text", "text": part["text"][:MAX_AI_TEXT_CHARS]}
                )
            elif part_type == "step-start":
                sanitized_parts.append({"type": "step-start"})
            elif part_type == "data-expired-prepared-file":
                data = part.get("data")
                if (
                    isinstance(data, dict)
                    and data.get("persistedState") == "expired"
                    and data.get("kind") in {"custom-export", "download"}
                ):
                    sanitized_parts.append(_expired_file_part(data["kind"]))
            elif isinstance(part_type, str) and part_type.startswith("tool-"):
                sanitized_part = _sanitize_tool_part(part)
                if sanitized_part:
                    sanitized_parts.append(sanitized_part)

        sanitized_messages.append(
            {"id": message_id, "role": role, "parts": sanitized_parts}
        )

    return sanitized_messages, usage_events


def conversation_title(messages: list[dict[str, Any]]) -> str:
    for message in messages:
        if message.get("role") != "user":
            continue
        text = " ".join(
            part.get("text", "")
            for part in message.get("parts", [])
            if part.get("type") == "text"
        ).strip()
        if text:
            return f"{text[:57].rstrip()}…" if len(text) > 58 else text
    return "New conversation"
