"""Tasks: visibility-aware viewing, comment access, priority, report-bug scoping.

Covers the change that opens the task board to all backoffice users (read +
comment) while respecting each task's visibility, adds a `priority` field, and
scopes reported bugs to the reporter's tenant.

The session-scoped `db` has no per-test rollback, so each test tags its rows with
a unique token and asserts membership rather than absolute counts.
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.task.models import Task
from app.api.task.schemas import TaskStatus, TaskType
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_task(
    db: Session,
    *,
    title: str,
    visibility: str,
    target_tenant_id: uuid.UUID | None = None,
) -> Task:
    task = Task(
        title=title,
        status=TaskStatus.TO_DO.value,
        type=TaskType.FEATURE.value,
        visibility=visibility,
        target_tenant_id=target_tenant_id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@pytest.fixture()
def visibility_tasks(db: Session, tenant_a: Tenants, tenant_b: Tenants) -> dict:
    tag = uuid.uuid4().hex[:8]
    return {
        "universal": _make_task(db, title=f"u-{tag}", visibility="universal"),
        "tenant_a": _make_task(
            db, title=f"ta-{tag}", visibility="tenant", target_tenant_id=tenant_a.id
        ),
        "tenant_b": _make_task(
            db, title=f"tb-{tag}", visibility="tenant", target_tenant_id=tenant_b.id
        ),
        "internal": _make_task(db, title=f"i-{tag}", visibility="internal"),
    }


def test_non_superadmin_list_respects_visibility(
    client, admin_token_tenant_a, visibility_tasks
) -> None:
    """A tenant_a admin sees universal + own-tenant tasks; not other-tenant nor internal."""
    r = client.get("/api/v1/tasks?limit=1000", headers=_auth(admin_token_tenant_a))
    assert r.status_code == 200
    ids = {t["id"] for t in r.json()["results"]}
    assert str(visibility_tasks["universal"].id) in ids
    assert str(visibility_tasks["tenant_a"].id) in ids
    assert str(visibility_tasks["tenant_b"].id) not in ids
    assert str(visibility_tasks["internal"].id) not in ids


def test_superadmin_sees_all_visibilities(
    client, superadmin_token, visibility_tasks
) -> None:
    r = client.get("/api/v1/tasks?limit=1000", headers=_auth(superadmin_token))
    ids = {t["id"] for t in r.json()["results"]}
    for key in ("universal", "tenant_a", "tenant_b", "internal"):
        assert str(visibility_tasks[key].id) in ids


def test_get_task_404_when_not_viewable(
    client, admin_token_tenant_a, visibility_tasks
) -> None:
    internal = client.get(
        f"/api/v1/tasks/{visibility_tasks['internal'].id}",
        headers=_auth(admin_token_tenant_a),
    )
    assert internal.status_code == 404
    universal = client.get(
        f"/api/v1/tasks/{visibility_tasks['universal'].id}",
        headers=_auth(admin_token_tenant_a),
    )
    assert universal.status_code == 200


def test_non_superadmin_cannot_mutate_tasks(client, admin_token_tenant_a) -> None:
    r = client.post(
        "/api/v1/tasks", headers=_auth(admin_token_tenant_a), json={"title": "nope"}
    )
    assert r.status_code == 403


def test_non_superadmin_can_comment_on_viewable_only(
    client, admin_token_tenant_a, visibility_tasks
) -> None:
    ok = client.post(
        f"/api/v1/tasks/{visibility_tasks['universal'].id}/comments",
        headers=_auth(admin_token_tenant_a),
        json={"body": "looking into it"},
    )
    assert ok.status_code == 201
    blocked = client.post(
        f"/api/v1/tasks/{visibility_tasks['internal'].id}/comments",
        headers=_auth(admin_token_tenant_a),
        json={"body": "should not work"},
    )
    assert blocked.status_code == 404


def test_priority_defaults_to_medium_and_roundtrips(client, superadmin_token) -> None:
    default = client.post(
        "/api/v1/tasks", headers=_auth(superadmin_token), json={"title": "prio-default"}
    )
    assert default.status_code == 201
    assert default.json()["priority"] == "medium"

    high = client.post(
        "/api/v1/tasks",
        headers=_auth(superadmin_token),
        json={"title": "prio-high", "priority": "high"},
    )
    assert high.status_code == 201
    assert high.json()["priority"] == "high"


def test_report_bug_is_scoped_to_reporter_tenant(
    client, admin_token_tenant_a, tenant_a: Tenants
) -> None:
    r = client.post(
        "/api/v1/tasks/report-bug",
        headers=_auth(admin_token_tenant_a),
        json={"title": "checkout button broken"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["type"] == "bug"
    assert body["visibility"] == "tenant"
    assert body["target_tenant_id"] == str(tenant_a.id)
