"""Regression: the authenticated-user TTLCache must survive concurrent access.

cachetools.TTLCache is not thread-safe and ``fetch_authenticated_user`` runs in
FastAPI's threadpool. Without a lock, concurrent expiry corrupted the cache in
production so every later insert raised ``KeyError`` in that worker.
"""

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from cachetools import TTLCache

from app.api.shared.enums import UserRole
from app.core.dependencies import users as users_dep
from app.core.security import TokenPayload


class _FakeResult:
    def __init__(self, user: SimpleNamespace) -> None:
        self._user = user

    def first(self) -> SimpleNamespace:
        return self._user


class _FakeSession:
    def __init__(self, users: dict[str, SimpleNamespace]) -> None:
        self._users = users

    def exec(self, statement):  # noqa: ANN001 — mimics Session.exec
        user_id = statement.whereclause.right.value
        return _FakeResult(self._users[str(user_id)])


def test_concurrent_cache_access_never_raises(monkeypatch) -> None:
    # A tiny TTL keeps entries expiring constantly, which is the racy path.
    monkeypatch.setattr(users_dep, "_user_cache", TTLCache(maxsize=1000, ttl=0.0005))

    users = {}
    for _ in range(50):
        uid = uuid.uuid4()
        users[str(uid)] = SimpleNamespace(
            id=uid,
            email=f"{uid.hex[:8]}@example.com",
            full_name=None,
            role=UserRole.ADMIN,
            deleted=False,
            tenant_id=None,
            auth_code=None,
            code_expiration=None,
        )
    db = _FakeSession(users)
    exp = datetime.now(UTC) + timedelta(hours=1)
    payloads = [TokenPayload(sub=uid, exp=exp, token_type="user") for uid in users]

    def hammer(worker: int) -> None:
        for i in range(2000):
            payload = payloads[(worker + i) % len(payloads)]
            result = users_dep.fetch_authenticated_user(payload, db)
            assert str(result.id) == payload.sub
            if i % 50 == 0:
                users_dep.invalidate_user_cache(result.id)

    with ThreadPoolExecutor(max_workers=16) as pool:
        for future in [pool.submit(hammer, w) for w in range(16)]:
            future.result()
