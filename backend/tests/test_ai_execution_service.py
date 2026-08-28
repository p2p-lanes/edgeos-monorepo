import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlmodel import Session, select

from app.api.ai_execution.models import AIExecutions
from app.api.ai_execution.service import (
    claim_execution,
    complete_execution,
    execution_key,
)
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _tool_call_id() -> str:
    return uuid.uuid4().hex * 2


def test_execution_claim_is_replayed_after_completion(
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
) -> None:
    tool_call_id = _tool_call_id()
    fingerprint = "a" * 64

    assert claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, fingerprint
    ) == ("acquired", None)
    assert claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, fingerprint
    ) == ("pending", None)

    result: dict[str, Any] = {"status": 201, "data": {"id": "record-1"}}
    complete_execution(
        db,
        tenant_a.id,
        admin_user_tenant_a.id,
        tool_call_id,
        fingerprint,
        result,
    )

    assert claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, fingerprint
    ) == ("completed", result)


def test_concurrent_execution_claim_has_one_winner(
    test_engine: Engine,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
) -> None:
    tool_call_id = _tool_call_id()
    fingerprint = "d" * 64

    def claim() -> str:
        with Session(test_engine) as session:
            state, _ = claim_execution(
                session,
                tenant_a.id,
                admin_user_tenant_a.id,
                tool_call_id,
                fingerprint,
            )
            return state

    with ThreadPoolExecutor(max_workers=2) as executor:
        states = list(executor.map(lambda _: claim(), range(2)))

    assert sorted(states) == ["acquired", "pending"]


def test_execution_claim_rejects_a_changed_payload(
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
) -> None:
    tool_call_id = _tool_call_id()
    claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, "a" * 64
    )

    with pytest.raises(HTTPException) as exc_info:
        claim_execution(
            db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, "b" * 64
        )

    assert exc_info.value.status_code == 409


def test_expired_execution_can_be_claimed_again(
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
) -> None:
    tool_call_id = _tool_call_id()
    fingerprint = "a" * 64
    claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, fingerprint
    )
    record = db.exec(
        select(AIExecutions).where(
            AIExecutions.tenant_id == tenant_a.id,
            AIExecutions.owner_user_id == admin_user_tenant_a.id,
            AIExecutions.execution_id == execution_key(tool_call_id),
        )
    ).one()
    record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.add(record)
    db.commit()

    assert claim_execution(
        db, tenant_a.id, admin_user_tenant_a.id, tool_call_id, fingerprint
    ) == ("acquired", None)


def test_execution_http_flow_uses_postgres_without_redis(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    execution_id = _tool_call_id()
    fingerprint = "c" * 64
    url = f"/api/v1/ai-executions/{execution_id}"
    headers = {
        "Authorization": f"Bearer {admin_token_tenant_a}",
        "X-Tenant-Id": str(tenant_a.id),
    }

    acquired = client.post(
        f"{url}/claim", headers=headers, json={"fingerprint": fingerprint}
    )
    assert acquired.status_code == 200, acquired.text
    assert acquired.json() == {"state": "acquired", "result": None}

    pending = client.post(
        f"{url}/claim", headers=headers, json={"fingerprint": fingerprint}
    )
    assert pending.status_code == 200, pending.text
    assert pending.json() == {"state": "pending", "result": None}

    result = {"status": 201, "data": {"id": "record-1"}}
    completed = client.post(
        f"{url}/complete",
        headers=headers,
        json={"fingerprint": fingerprint, "result": result},
    )
    assert completed.status_code == 204, completed.text

    replayed = client.post(
        f"{url}/claim", headers=headers, json={"fingerprint": fingerprint}
    )
    assert replayed.status_code == 200, replayed.text
    assert replayed.json() == {"state": "completed", "result": result}
