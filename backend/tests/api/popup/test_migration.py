"""Tests for the tenant-scoped popup slug migration (0043_tenant_scoped_popup_slug).

Scenarios (REQ-E.1, REQ-E.2):
  1. uq_popups_tenant_slug unique index exists after upgrade
  2. popups_slug_key constraint does NOT exist after upgrade
  3. ix_popups_slug non-unique index exists after upgrade
  4. Two rows with same slug but different tenant_id succeed after migration
  5. downgrade refuses (raises RuntimeError) when cross-tenant duplicates exist
  6. downgrade restores popups_slug_key when no duplicates exist (logic test)
"""

import importlib.util
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import sqlalchemy as sa
from sqlmodel import Session


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[3]
        / "app"
        / "alembic"
        / "versions"
    )
    matches = list(migration_path.glob("0043_tenant_scoped_popup_slug.py"))
    assert matches, "0043_tenant_scoped_popup_slug migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTenantScopedPopupSlugMigration:
    """Schema-level assertions for the 0043 migration.

    These tests run against the shared test DB which is already at `head`
    (the session-scoped test_engine ran `upgrade head` at session start).
    The new 0043 migration must be present for these to pass.
    """

    def test_composite_unique_index_exists(self, db: Session) -> None:
        """uq_popups_tenant_slug unique index must exist after upgrade."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'popups'
              AND indexname = 'uq_popups_tenant_slug'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'uq_popups_tenant_slug' not found on popups table. "
            "Run migration 0043 to create it."
        )

    def test_composite_unique_index_is_unique(self, db: Session) -> None:
        """uq_popups_tenant_slug must be a UNIQUE index."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT ix.indisunique
            FROM pg_indexes pi
            JOIN pg_class c ON c.relname = pi.indexname
            JOIN pg_index ix ON ix.indexrelid = c.oid
            WHERE pi.tablename = 'popups'
              AND pi.indexname = 'uq_popups_tenant_slug'
            """
        ).fetchone()
        assert row is not None, "uq_popups_tenant_slug index not found in pg_index"
        assert row[0] is True, "uq_popups_tenant_slug must be a unique index"

    def test_old_global_unique_constraint_removed(self, db: Session) -> None:
        """popups_slug_key constraint must NOT exist after migration 0043."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'popups'::regclass
              AND conname = 'popups_slug_key'
            """
        ).fetchone()
        assert row is None, (
            "Constraint 'popups_slug_key' still exists. "
            "Migration 0043 should have dropped it."
        )

    def test_non_unique_slug_index_exists(self, db: Session) -> None:
        """ix_popups_slug must exist as a non-unique index after migration."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT ix.indisunique
            FROM pg_indexes pi
            JOIN pg_class c ON c.relname = pi.indexname
            JOIN pg_index ix ON ix.indexrelid = c.oid
            WHERE pi.tablename = 'popups'
              AND pi.indexname = 'ix_popups_slug'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_popups_slug' not found on popups table after migration."
        )
        assert row[0] is False, "ix_popups_slug must be a non-unique index"

    def test_same_slug_different_tenants_can_coexist(
        self, db: Session, tenant_a, tenant_b
    ) -> None:
        """Two rows with same slug but different tenant_id must succeed post-migration."""
        conn = db.connection()
        slug = f"migration-test-{uuid.uuid4().hex[:8]}"

        try:
            conn.exec_driver_sql(
                """
                INSERT INTO popups (id, name, slug, tenant_id, sale_type, checkout_mode,
                                    status, currency, default_language,
                                    supported_languages, insurance_enabled,
                                    allows_scholarship, allows_incentive,
                                    requires_application_fee,
                                    tier_progression_enabled, events_enabled,
                                    application_layout)
                VALUES (%s, %s, %s, %s, 'application', 'pass_system',
                        'draft', 'USD', 'en', '{en}', false,
                        false, false, false, false, true, 'single_page')
                """,
                (str(uuid.uuid4()), f"Migration Test A {slug}", slug, str(tenant_a.id)),
            )
            conn.exec_driver_sql(
                """
                INSERT INTO popups (id, name, slug, tenant_id, sale_type, checkout_mode,
                                    status, currency, default_language,
                                    supported_languages, insurance_enabled,
                                    allows_scholarship, allows_incentive,
                                    requires_application_fee,
                                    tier_progression_enabled, events_enabled,
                                    application_layout)
                VALUES (%s, %s, %s, %s, 'application', 'pass_system',
                        'draft', 'USD', 'en', '{en}', false,
                        false, false, false, false, true, 'single_page')
                """,
                (str(uuid.uuid4()), f"Migration Test B {slug}", slug, str(tenant_b.id)),
            )

            rows = conn.exec_driver_sql(
                "SELECT id FROM popups WHERE slug = %s", (slug,)
            ).fetchall()
            assert len(rows) == 2, (
                f"Expected 2 rows with slug={slug!r}, found {len(rows)}"
            )
        finally:
            conn.exec_driver_sql("DELETE FROM popups WHERE slug = %s", (slug,))


class TestTenantScopedPopupSlugDowngradeSafety:
    """Tests for the downgrade safety guard.

    These tests call the migration module's downgrade() logic directly
    using mocks to avoid actually running DDL against the shared test DB.
    This isolates the guard logic without disrupting the shared DB state.
    """

    def test_downgrade_refuses_when_cross_tenant_duplicates_exist(self) -> None:
        """downgrade must raise RuntimeError if cross-tenant slug duplicates exist."""
        module = _load_migration_module()

        mock_bind = MagicMock()
        mock_result = MagicMock()
        mock_result.first.return_value = ("summer-fest",)
        mock_bind.execute.return_value = mock_result

        with (
            patch.object(module, "op") as mock_op,
        ):
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="cross-tenant duplicate slug"):
                module.downgrade()

    def test_downgrade_uses_concurrently_in_production_path(self) -> None:
        """Production path (non-transactional bind) must wrap DROP INDEX in autocommit_block."""
        module = _load_migration_module()

        mock_bind = MagicMock()
        # Force the production branch: _is_transactional_connection() reads
        # bind.in_transaction(), so mock that explicitly to False.
        mock_bind.in_transaction.return_value = False
        mock_result = MagicMock()
        mock_result.first.return_value = None
        mock_bind.execute.return_value = mock_result

        mock_context = MagicMock()
        mock_context.__enter__ = MagicMock(return_value=None)
        mock_context.__exit__ = MagicMock(return_value=False)

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind
            mock_op.get_context.return_value.autocommit_block.return_value = (
                mock_context
            )

            module.downgrade()

            mock_op.get_context.return_value.autocommit_block.assert_called_once()
            mock_op.drop_index.assert_called()
            mock_op.create_index.assert_called()
            mock_op.create_unique_constraint.assert_called_with(
                "popups_slug_key", "popups", ["slug"]
            )

    def test_downgrade_skips_concurrently_in_test_path(self) -> None:
        """Test-env path (transactional bind) must NOT call autocommit_block."""
        module = _load_migration_module()

        mock_bind = MagicMock()
        # Test branch: connection is already inside a BEGIN block.
        mock_bind.in_transaction.return_value = True
        mock_result = MagicMock()
        mock_result.first.return_value = None
        mock_bind.execute.return_value = mock_result

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.downgrade()

            mock_op.get_context.return_value.autocommit_block.assert_not_called()
            mock_op.drop_index.assert_called()
            mock_op.create_index.assert_called()
            mock_op.create_unique_constraint.assert_called_with(
                "popups_slug_key", "popups", ["slug"]
            )
