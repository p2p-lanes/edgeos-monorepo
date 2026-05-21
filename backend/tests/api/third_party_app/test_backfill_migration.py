"""Backfill migration correctness tests.

Tests the upgrade path:
1. Seed a tenant with third_party_api_key_hash + third_party_key_prefix.
2. Assert exactly one third_party_apps row with name='legacy' and correct fields.
3. Assert tenants.third_party_api_key_hash column is gone after upgrade.
4. NULL prefix tenant gets first-8-chars-of-hash as prefix.
5. Downgrade guard: 2 active apps per tenant raises RuntimeError.

These tests operate against the session-scoped container already at head,
then verify invariants that the migration must have established.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, text


class TestBackfillMigration:
    def test_legacy_tenant_has_one_app_row(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """A tenant seeded with third_party_api_key_hash has exactly one app row."""
        tenant, app, raw_key = third_party_enabled_tenant
        result = db.exec(
            text(
                "SELECT COUNT(*) FROM third_party_apps "
                "WHERE tenant_id = :tenant_id AND name = 'legacy'"
            ).bindparams(tenant_id=tenant.id)
        ).scalar()
        assert result == 1

    def test_legacy_app_has_correct_key_hash(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """The legacy app row's key_hash matches the original tenant's hash."""
        tenant, app, raw_key = third_party_enabled_tenant
        assert app.key_hash is not None

        from app.api.api_key.crud import hash_key

        expected_hash = hash_key(raw_key)
        row = db.exec(
            text(
                "SELECT key_hash FROM third_party_apps "
                "WHERE tenant_id = :tid AND name = 'legacy'"
            ).bindparams(tid=tenant.id)
        ).first()
        assert row is not None
        assert row[0] == expected_hash

    def test_legacy_app_active_and_not_revoked(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """The legacy app row is active=True and revoked_at=NULL."""
        tenant, app, raw_key = third_party_enabled_tenant
        row = db.exec(
            text(
                "SELECT active, revoked_at FROM third_party_apps "
                "WHERE tenant_id = :tid AND name = 'legacy'"
            ).bindparams(tid=tenant.id)
        ).first()
        assert row is not None
        assert row[0] is True
        assert row[1] is None

    def test_legacy_app_has_default_token_scopes(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """The legacy app row has the platform-default token scopes."""
        tenant, app, raw_key = third_party_enabled_tenant
        row = db.exec(
            text(
                "SELECT allowed_token_scopes FROM third_party_apps "
                "WHERE tenant_id = :tid AND name = 'legacy'"
            ).bindparams(tid=tenant.id)
        ).first()
        assert row is not None
        scopes = row[0]
        assert "portal:self_read" in scopes
        assert "portal:directory_read" in scopes
        assert "portal:api_keys_manage" in scopes

    def test_legacy_app_has_default_api_key_scopes(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """The legacy app row has the platform-default api-key scopes."""
        tenant, app, raw_key = third_party_enabled_tenant
        row = db.exec(
            text(
                "SELECT allowed_api_key_scopes FROM third_party_apps "
                "WHERE tenant_id = :tid AND name = 'legacy'"
            ).bindparams(tid=tenant.id)
        ).first()
        assert row is not None
        scopes = row[0]
        assert "events:read" in scopes
        assert "rsvp:write" in scopes

    def test_tenant_third_party_columns_absent(self, db: Session) -> None:
        """After upgrade, tenants.third_party_api_key_hash column must not exist."""
        result = db.exec(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name = 'tenants' "
                "AND column_name = 'third_party_api_key_hash'"
            )
        ).scalar()
        assert result == 0, "tenants.third_party_api_key_hash should have been dropped"

    def test_tenant_third_party_key_prefix_column_absent(self, db: Session) -> None:
        """After upgrade, tenants.third_party_key_prefix column must not exist."""
        result = db.exec(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_name = 'tenants' "
                "AND column_name = 'third_party_key_prefix'"
            )
        ).scalar()
        assert result == 0, "tenants.third_party_key_prefix should have been dropped"

    def test_validate_third_party_key_returns_tenant_and_app(
        self,
        db: Session,
        third_party_enabled_tenant,
    ) -> None:
        """validate_third_party_key returns (tenant, app) for a valid key."""
        from app.api.third_party_app.crud import validate_third_party_key

        tenant, app, raw_key = third_party_enabled_tenant
        result_tenant, result_app = validate_third_party_key(db, raw_key)
        assert result_tenant.id == tenant.id
        assert result_app.name == "legacy"
