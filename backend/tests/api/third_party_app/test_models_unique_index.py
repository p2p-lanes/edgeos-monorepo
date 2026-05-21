"""Partial unique index tests for ThirdPartyApps.

Asserts:
- (tenant_id, lower(name)) WHERE revoked_at IS NULL rejects duplicates.
- Same name after revocation is allowed (revoked row doesn't count).

RED-phase: tests fail until model + migration exist.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.api.tenant.models import Tenants


def _make_app(db: Session, *, tenant_id: uuid.UUID, name: str, revoked: bool = False):
    from app.api.third_party_app.models import ThirdPartyApps

    app = ThirdPartyApps(
        tenant_id=tenant_id,
        name=name,
        key_hash=f"hash-{uuid.uuid4().hex}",
        prefix="prefix",
        active=not revoked,
        revoked_at=datetime.now(UTC) if revoked else None,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


class TestPartialUniqueIndex:
    def test_duplicate_active_name_per_tenant_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Two active apps with same name (case-insensitive) on same tenant -> IntegrityError."""
        _make_app(db, tenant_id=tenant_a.id, name="UniqueApp")
        with pytest.raises(IntegrityError):
            _make_app(db, tenant_id=tenant_a.id, name="uniqueapp")
        db.rollback()

    def test_same_name_after_revocation_is_allowed(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """After revoking an app, same name can be reused."""
        _make_app(db, tenant_id=tenant_a.id, name="ReusableName", revoked=True)
        new_app = _make_app(db, tenant_id=tenant_a.id, name="ReusableName")
        assert new_app.id is not None
        db.delete(new_app)
        db.commit()

    def test_same_name_different_tenant_allowed(
        self, db: Session, tenant_a: Tenants, tenant_b: Tenants
    ) -> None:
        """Same name on different tenants is allowed."""
        app_a = _make_app(db, tenant_id=tenant_a.id, name="SharedName")
        app_b = _make_app(db, tenant_id=tenant_b.id, name="SharedName")
        assert app_a.id != app_b.id
        db.delete(app_a)
        db.delete(app_b)
        db.commit()
