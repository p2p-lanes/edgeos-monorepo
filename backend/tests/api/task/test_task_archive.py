"""Tasks: archive / unarchive (individual + bulk archive-published).

Archiving is orthogonal to status: it hides a task from the active board
(``archived=false``) without changing its column, and the archive view
(``archived=true``) surfaces it. Superadmin-only.

The session-scoped ``db`` has no per-test rollback, so each test tags its rows
with a unique token and asserts membership rather than absolute counts.
"""

import uuid


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create(client, token: str, *, title: str, status: str = "to_do") -> dict:
    r = client.post(
        "/api/v1/tasks",
        headers=_auth(token),
        json={"title": title, "status": status},
    )
    assert r.status_code == 201, r.text
    return r.json()


def _ids(client, token: str, *, archived: bool) -> set[str]:
    r = client.get(
        f"/api/v1/tasks?limit=1000&archived={'true' if archived else 'false'}",
        headers=_auth(token),
    )
    assert r.status_code == 200
    return {t["id"] for t in r.json()["results"]}


def test_archive_and_unarchive_roundtrip(client, superadmin_token) -> None:
    task = _create(client, superadmin_token, title=f"arch-{uuid.uuid4().hex[:8]}")
    tid = task["id"]
    assert task["archived_at"] is None

    archived = client.post(
        f"/api/v1/tasks/{tid}/archive", headers=_auth(superadmin_token)
    )
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    # Active board hides it; archive view surfaces it.
    assert tid not in _ids(client, superadmin_token, archived=False)
    assert tid in _ids(client, superadmin_token, archived=True)

    unarchived = client.post(
        f"/api/v1/tasks/{tid}/unarchive", headers=_auth(superadmin_token)
    )
    assert unarchived.status_code == 200
    assert unarchived.json()["archived_at"] is None
    assert tid in _ids(client, superadmin_token, archived=False)
    assert tid not in _ids(client, superadmin_token, archived=True)


def test_archive_published_only_touches_published(client, superadmin_token) -> None:
    tag = uuid.uuid4().hex[:8]
    pub1 = _create(client, superadmin_token, title=f"p1-{tag}", status="published")
    pub2 = _create(client, superadmin_token, title=f"p2-{tag}", status="published")
    todo = _create(client, superadmin_token, title=f"t-{tag}", status="to_do")

    r = client.post(
        "/api/v1/tasks/archive-published", headers=_auth(superadmin_token)
    )
    assert r.status_code == 200
    assert r.json()["archived"] >= 2

    archived_ids = _ids(client, superadmin_token, archived=True)
    active_ids = _ids(client, superadmin_token, archived=False)
    assert pub1["id"] in archived_ids
    assert pub2["id"] in archived_ids
    # The to_do task is untouched and stays on the active board.
    assert todo["id"] in active_ids
    assert todo["id"] not in archived_ids


def test_archive_endpoints_are_superadmin_only(
    client, admin_token_tenant_a, superadmin_token
) -> None:
    task = _create(client, superadmin_token, title=f"perm-{uuid.uuid4().hex[:8]}")
    tid = task["id"]
    for resp in (
        client.post(f"/api/v1/tasks/{tid}/archive", headers=_auth(admin_token_tenant_a)),
        client.post(
            f"/api/v1/tasks/{tid}/unarchive", headers=_auth(admin_token_tenant_a)
        ),
        client.post(
            "/api/v1/tasks/archive-published", headers=_auth(admin_token_tenant_a)
        ),
    ):
        assert resp.status_code == 403
