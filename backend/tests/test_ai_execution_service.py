import json
import uuid
from typing import Any

import pytest
from fastapi import HTTPException

from app.api.ai_execution.service import (
    claim_execution,
    complete_execution,
    execution_key,
)


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def set(
        self,
        key: str,
        value: str,
        *,
        nx: bool = False,
        xx: bool = False,
        ex: int | None = None,
    ) -> bool:
        del ex
        if nx and key in self.values:
            return False
        if xx and key not in self.values:
            return False
        self.values[key] = value
        return True

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def eval(
        self,
        script: str,
        key_count: int,
        key: str,
        fingerprint: str,
        completed: str,
        ttl: int,
    ) -> int:
        del script, key_count, ttl
        current = self.values.get(key)
        if current is None:
            return 0
        if json.loads(current)["fingerprint"] != fingerprint:
            return -1
        self.values[key] = completed
        return 1


def test_execution_claim_is_replayed_after_completion() -> None:
    client = FakeRedis()
    key = execution_key(uuid.uuid4(), uuid.uuid4(), "tool-call-1")
    fingerprint = "a" * 64

    assert claim_execution(client, key, fingerprint) == ("acquired", None)  # type: ignore[arg-type]
    assert claim_execution(client, key, fingerprint) == ("pending", None)  # type: ignore[arg-type]

    result: dict[str, Any] = {"status": 201, "data": {"id": "record-1"}}
    complete_execution(client, key, fingerprint, result)  # type: ignore[arg-type]

    assert claim_execution(client, key, fingerprint) == ("completed", result)  # type: ignore[arg-type]
    assert json.loads(client.values[key])["state"] == "completed"


def test_execution_claim_rejects_a_changed_payload() -> None:
    client = FakeRedis()
    key = execution_key(uuid.uuid4(), uuid.uuid4(), "tool-call-1")
    claim_execution(client, key, "a" * 64)  # type: ignore[arg-type]

    with pytest.raises(HTTPException) as exc_info:
        claim_execution(client, key, "b" * 64)  # type: ignore[arg-type]

    assert exc_info.value.status_code == 409
