import hashlib
import json
import uuid
from typing import Any

from fastapi import HTTPException, status
from redis import RedisError
from redis.client import Redis

EXECUTION_TTL_SECONDS = 60 * 60
_COMPLETE_SCRIPT = """
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.fingerprint ~= ARGV[1] then return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""


def execution_key(tenant_id: uuid.UUID, user_id: uuid.UUID, tool_call_id: str) -> str:
    """Build a bounded Redis key without embedding model-controlled text."""
    tool_hash = hashlib.sha256(tool_call_id.encode()).hexdigest()
    return f"edgeos:ai:execution:{tenant_id}:{user_id}:{tool_hash}"


def _decode_record(raw: str | bytes | None) -> dict[str, Any] | None:
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI execution store contains an invalid record",
        ) from exc
    if not isinstance(value, dict):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The AI execution store contains an invalid record",
        )
    return value


def claim_execution(
    client: Redis,
    key: str,
    fingerprint: str,
) -> tuple[str, Any]:
    """Atomically claim an approved write or return its durable prior state."""
    pending = json.dumps(
        {"fingerprint": fingerprint, "state": "pending"},
        separators=(",", ":"),
    )
    try:
        if client.set(key, pending, nx=True, ex=EXECUTION_TTL_SECONDS):
            return "acquired", None
        record = _decode_record(client.get(key))
        # The key may expire between SET NX and GET. Retry one atomic claim.
        if record is None and client.set(
            key,
            pending,
            nx=True,
            ex=EXECUTION_TTL_SECONDS,
        ):
            return "acquired", None
    except RedisError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Durable AI write protection is unavailable",
        ) from exc

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Durable AI write protection is unavailable",
        )
    if record.get("fingerprint") != fingerprint:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The approved operation payload cannot be changed",
        )
    if record.get("state") == "completed":
        return "completed", record.get("result")
    return "pending", None


def complete_execution(
    client: Redis,
    key: str,
    fingerprint: str,
    result: Any,
) -> None:
    """Persist the sanitized successful result for safe replay."""
    completed = json.dumps(
        {
            "fingerprint": fingerprint,
            "state": "completed",
            "result": result,
        },
        separators=(",", ":"),
    )
    try:
        stored = int(
            client.eval(
                _COMPLETE_SCRIPT,
                1,
                key,
                fingerprint,
                completed,
                EXECUTION_TTL_SECONDS,
            )
        )
        if stored <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The AI execution claim is missing, expired, or changed",
            )
    except RedisError as exc:
        # Fail closed after an ambiguous write. The pending claim remains and
        # prevents another replica or restarted service from executing it again.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The operation completed but its durable result could not be stored",
        ) from exc
