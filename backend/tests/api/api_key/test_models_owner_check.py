"""Tests for ApiKeys XOR ownership constraint.

These are the RED-phase tests for Block 1. They validate that the DB-level
CHECK constraint `api_keys_owner_check` enforces exactly one of (human_id,
user_id) is non-null.

Tests are expected to FAIL until:
  1. The Alembic migration adds the constraint.
  2. The ApiKeys model is updated to support nullable human_id and user_id.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.api.api_key.crud import display_prefix, generate_raw_key, hash_key
from app.api.api_key.models import ApiKeys
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _make_api_key_row(
    *,
    tenant_id: uuid.UUID,
    human_id: uuid.UUID | None,
    user_id: uuid.UUID | None,
) -> ApiKeys:
    raw = generate_raw_key()
    return ApiKeys(
        tenant_id=tenant_id,
        human_id=human_id,
        user_id=user_id,
        name="test-owner-check",
        key_hash=hash_key(raw),
        prefix=display_prefix(raw),
        scopes=["events:read"],
    )


class TestApiKeysOwnerXorConstraint:
    """Four-way matrix: both-null, both-set, human-only, user-only."""

    def test_insert_with_both_null_fails(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """DB must reject a row where both human_id and user_id are NULL."""
        row = _make_api_key_row(
            tenant_id=tenant_a.id,
            human_id=None,
            user_id=None,
        )
        db.add(row)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    def test_insert_with_both_set_fails(
        self,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        """DB must reject a row where both human_id and user_id are non-NULL."""
        some_human_id = uuid.uuid4()  # fake uuid; FK check fires after XOR check
        row = _make_api_key_row(
            tenant_id=tenant_a.id,
            human_id=some_human_id,
            user_id=admin_user_tenant_a.id,
        )
        db.add(row)
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    def test_insert_with_human_only_succeeds(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A row with human_id set and user_id=None must be accepted by the DB."""
        from app.api.human.models import Humans

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"owner-check-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Test",
            last_name="Human",
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        row = _make_api_key_row(
            tenant_id=tenant_a.id,
            human_id=human.id,
            user_id=None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        assert row.id is not None
        assert row.human_id == human.id
        assert row.user_id is None

        # Cleanup
        db.delete(row)
        db.commit()

    def test_insert_with_user_only_succeeds(
        self, db: Session, tenant_a: Tenants, admin_user_tenant_a: Users
    ) -> None:
        """A row with user_id set and human_id=None must be accepted by the DB."""
        row = _make_api_key_row(
            tenant_id=tenant_a.id,
            human_id=None,
            user_id=admin_user_tenant_a.id,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        assert row.id is not None
        assert row.user_id == admin_user_tenant_a.id
        assert row.human_id is None

        # Cleanup
        db.delete(row)
        db.commit()
