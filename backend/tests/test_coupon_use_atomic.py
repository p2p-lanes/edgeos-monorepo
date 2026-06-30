"""Regression tests for atomic coupon redemption (concurrency).

`use_coupon` did a read-modify-write (`coupon.current_uses += 1; commit`).
Combined with the separate `validate_coupon` check, two concurrent checkouts
could both pass `current_uses < max_uses`, both redeem a single-use coupon,
and lost-update the counter.

The fix performs a single conditional UPDATE guarded by
`current_uses < max_uses`, so the row lock serialises concurrent writers and
the second one matches zero rows once the cap is reached. It also no longer
commits internally, so the redemption rolls back with the caller's payment if
checkout later fails.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.api.coupon.crud import coupons_crud


class _Result:
    def __init__(self, rowcount: int):
        self.rowcount = rowcount


class _FakeSession:
    def __init__(self, rowcount: int, coupon):
        self._rowcount = rowcount
        self._coupon = coupon
        self.statements = []
        self.refreshed = False
        self.committed = False

    def exec(self, statement):
        self.statements.append(statement)
        return _Result(self._rowcount)

    def get(self, _model, _coupon_id):
        return self._coupon

    def refresh(self, _obj):
        self.refreshed = True

    def commit(self):
        self.committed = True


def _sql(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))


def test_use_coupon_issues_conditional_update_and_commits_on_success() -> None:
    coupon = SimpleNamespace(id=uuid.uuid4(), current_uses=0, max_uses=1)
    session = _FakeSession(rowcount=1, coupon=coupon)

    result = coupons_crud.use_coupon(session, coupon.id)

    assert result is coupon
    assert session.refreshed is True
    # Commit on success releases the coupon row lock promptly, rather than
    # holding it across a following SimpleFI network call in some checkout flows.
    assert session.committed is True
    sql = _sql(session.statements[0])
    assert "UPDATE coupons" in sql
    assert "current_uses < coupons.max_uses" in sql
    assert "max_uses IS NULL" in sql


def test_use_coupon_exhausted_raises_400_without_committing() -> None:
    coupon = SimpleNamespace(id=uuid.uuid4(), current_uses=1, max_uses=1)
    session = _FakeSession(rowcount=0, coupon=coupon)

    with pytest.raises(HTTPException) as exc:
        coupons_crud.use_coupon(session, coupon.id)
    assert exc.value.status_code == 400
    # Must NOT commit on the rejection path, so any half-built payment the
    # caller flushed is discarded on transaction teardown (no orphan row).
    assert session.committed is False


def test_use_coupon_missing_raises_404_without_committing() -> None:
    session = _FakeSession(rowcount=0, coupon=None)

    with pytest.raises(HTTPException) as exc:
        coupons_crud.use_coupon(session, uuid.uuid4())
    assert exc.value.status_code == 404
    assert session.committed is False
