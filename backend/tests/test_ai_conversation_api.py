import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.ai_conversation.models import AIConversations
from app.api.tenant.models import Tenants


def _headers(token: str, tenant: Tenants) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-Id": str(tenant.id),
    }


def _messages(event_id: uuid.UUID | None = None) -> list[dict]:
    assistant: dict = {
        "id": "assistant-1",
        "role": "assistant",
        "parts": [
            {"type": "text", "text": "There are two pending applications."},
            {
                "type": "tool-prepareCustomExport",
                "toolCallId": "export-1",
                "state": "output-available",
                "input": {"filters": [{"value": "private@example.com"}]},
                "output": {
                    "spec": {"filename": "private"},
                    "fingerprint": "secret-fingerprint",
                },
            },
            {
                "type": "tool-executeOperation",
                "toolCallId": "approved-1",
                "state": "approval-responded",
                "approval": {
                    "id": "approval-1",
                    "approved": True,
                    "signature": "stale-signature",
                },
                "input": {"operationId": "submit_review"},
            },
        ],
    }
    if event_id:
        assistant["metadata"] = {
            "edgeosUsage": {
                "eventId": str(event_id),
                "provider": "openai",
                "model": "gpt-edgeos",
                "inputTokens": 120,
                "cachedInputTokens": 20,
                "outputTokens": 40,
                "reasoningTokens": 10,
            }
        }
    return [
        {
            "id": "user-1",
            "role": "user",
            "parts": [{"type": "text", "text": "Show pending applications"}],
        },
        assistant,
    ]


def test_conversation_crud_sanitizes_files_and_records_usage_once(
    client: TestClient,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    conversation_id = uuid.uuid4()
    event_id = uuid.uuid4()
    url = f"/api/v1/ai-conversations/{conversation_id}"
    headers = _headers(admin_token_tenant_a, tenant_a)

    created = client.put(url, headers=headers, json={"messages": _messages(event_id)})
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["title"] == "Show pending applications"
    assert body["revision"] == 1
    assert body["messages"][1]["parts"][1] == {
        "type": "data-expired-prepared-file",
        "data": {"persistedState": "expired", "kind": "custom-export"},
    }
    assert "metadata" not in body["messages"][1]
    assert "private@example.com" not in created.text
    assert "secret-fingerprint" not in created.text
    assert "stale-signature" not in created.text
    assert body["messages"][1]["parts"][2]["state"] == "output-denied"
    assert body["messages"][1]["parts"][2]["approval"]["approved"] is False
    assert body["usage"] == {
        "input_tokens": 120,
        "cached_input_tokens": 20,
        "output_tokens": 40,
        "reasoning_tokens": 10,
        "models": ["gpt-edgeos"],
        "providers": ["openai"],
        "response_count": 1,
    }

    repeated = client.put(url, headers=headers, json={"messages": _messages(event_id)})
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["revision"] == 2
    assert repeated.json()["usage"]["response_count"] == 1

    listed = client.get("/api/v1/ai-conversations", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [item["id"] for item in listed.json()] == [str(conversation_id)]

    fetched = client.get(url, headers=headers)
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["usage"]["input_tokens"] == 120

    deleted = client.delete(url, headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert client.get(url, headers=headers).status_code == 404


def test_conversations_are_private_to_the_owner(
    client: TestClient,
    admin_token_tenant_a: str,
    operator_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    conversation_id = uuid.uuid4()
    url = f"/api/v1/ai-conversations/{conversation_id}"
    created = client.put(
        url,
        headers=_headers(admin_token_tenant_a, tenant_a),
        json={"messages": _messages()},
    )
    assert created.status_code == 200, created.text

    operator_headers = _headers(operator_token_tenant_a, tenant_a)
    assert client.get(url, headers=operator_headers).status_code == 404
    assert client.delete(url, headers=operator_headers).status_code == 404
    assert client.get("/api/v1/ai-conversations", headers=operator_headers).json() == []
    assert (
        client.delete(url, headers=_headers(admin_token_tenant_a, tenant_a)).status_code
        == 204
    )


def test_viewer_and_check_in_controller_cannot_access_conversations(
    client: TestClient,
    viewer_token_tenant_a: str,
    check_in_controller_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    for token in (viewer_token_tenant_a, check_in_controller_token_tenant_a):
        response = client.get(
            "/api/v1/ai-conversations", headers=_headers(token, tenant_a)
        )
        assert response.status_code == 403, response.text


def test_history_keeps_only_eight_recent_conversations(
    client: TestClient,
    operator_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    headers = _headers(operator_token_tenant_a, tenant_a)
    ids = [uuid.uuid4() for _ in range(9)]
    for index, conversation_id in enumerate(ids):
        response = client.put(
            f"/api/v1/ai-conversations/{conversation_id}",
            headers=headers,
            json={
                "messages": [
                    {
                        "id": f"user-{index}",
                        "role": "user",
                        "parts": [{"type": "text", "text": f"Conversation {index}"}],
                    }
                ]
            },
        )
        assert response.status_code == 200, response.text

    listed = client.get("/api/v1/ai-conversations", headers=headers)
    assert listed.status_code == 200, listed.text
    listed_ids = [item["id"] for item in listed.json()]
    assert len(listed_ids) == 8
    assert str(ids[0]) not in listed_ids

    for conversation_id in ids[1:]:
        client.delete(f"/api/v1/ai-conversations/{conversation_id}", headers=headers)


def test_expired_conversations_are_removed_from_history(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    conversation_id = uuid.uuid4()
    headers = _headers(admin_token_tenant_a, tenant_a)
    created = client.put(
        f"/api/v1/ai-conversations/{conversation_id}",
        headers=headers,
        json={"messages": _messages()},
    )
    assert created.status_code == 200, created.text

    conversation = db.get(AIConversations, conversation_id)
    assert conversation is not None
    conversation.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.add(conversation)
    db.commit()

    listed = client.get("/api/v1/ai-conversations", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json() == []
    assert db.get(AIConversations, conversation_id) is None
