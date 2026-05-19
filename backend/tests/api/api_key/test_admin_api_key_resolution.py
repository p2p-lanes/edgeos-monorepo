"""Tests for _resolve_api_key with admin-owned api keys.

Validates:
  - Human-owned key row returns token_type="human".
  - Admin-owned key row (user_id set) returns token_type="user".
  - Admin-owned key sets api_key_tenant_id on the TokenPayload (FLAG-2 fix).

These tests use the database (testcontainers) to verify the full resolution path.
"""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import Session

from app.api.api_key import crud as api_key_crud
from app.api.api_key.models import ApiKeys
from app.api.human.models import Humans
from app.api.tenant.models import Tenants
from app.api.user.models import Users


class TestResolveApiKeyOwnership:
    """_resolve_api_key returns the correct token_type and api_key_tenant_id."""

    def test_resolve_api_key_for_human_owned_row_sets_token_type_human(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Human-owned key resolves to token_type='human'."""
        from unittest.mock import patch

        from app.core.security import _resolve_api_key

        # Create a human for this test
        human = Humans(
            email=f"human-apikey-test-{uuid.uuid4().hex[:8]}@test.com",
            tenant_id=tenant_a.id,
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        raw = api_key_crud.generate_raw_key()
        row = ApiKeys(
            tenant_id=tenant_a.id,
            human_id=human.id,
            user_id=None,
            name="test-human-key",
            key_hash=api_key_crud.hash_key(raw),
            prefix=api_key_crud.display_prefix(raw),
            scopes=["events:read"],
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        # Patch the engine used inside _resolve_api_key to our test engine.
        from app.core.db import engine as real_engine
        from sqlmodel import create_engine

        with patch("app.core.security.engine", db.get_bind()):
            payload = _resolve_api_key(raw)

        assert payload.token_type == "human"
        assert payload.sub == str(human.id)
        assert payload.via_api_key is True
        assert payload.api_key_tenant_id is None  # human keys don't set this

        # Cleanup
        db.delete(row)
        db.delete(human)
        db.commit()

    def test_resolve_api_key_for_user_owned_row_sets_token_type_user(
        self,
        db: Session,
        admin_user_tenant_a: Users,
        tenant_a: Tenants,
        admin_api_key_factory,
    ) -> None:
        """Admin-owned key resolves to token_type='user'."""
        from unittest.mock import patch

        from app.core.security import _resolve_api_key

        row, raw = admin_api_key_factory(scopes=["attendees:read"])

        with patch("app.core.security.engine", db.get_bind()):
            payload = _resolve_api_key(raw)

        assert payload.token_type == "user"
        assert payload.sub == str(admin_user_tenant_a.id)
        assert payload.via_api_key is True

    def test_resolve_api_key_synthesises_api_key_tenant_id(
        self,
        db: Session,
        admin_user_tenant_a: Users,
        tenant_a: Tenants,
        admin_api_key_factory,
    ) -> None:
        """Admin-owned key sets api_key_tenant_id from the key's tenant_id (FLAG-2 fix)."""
        from unittest.mock import patch

        from app.core.security import _resolve_api_key

        row, raw = admin_api_key_factory(scopes=["attendees:read"])

        with patch("app.core.security.engine", db.get_bind()):
            payload = _resolve_api_key(raw)

        # api_key_tenant_id must be set to the key's tenant so that
        # get_admin_or_api_key_tenant_session can resolve the tenant
        # without needing to go through CurrentUser.
        assert payload.api_key_tenant_id == tenant_a.id
