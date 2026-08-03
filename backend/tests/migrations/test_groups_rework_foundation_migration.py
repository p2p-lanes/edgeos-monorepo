"""Smoke tests for the bfaabd563367_groups_rework migration (PR-1 DB foundation).

These tests run against the shared session-scoped test DB (already at `head`
after conftest.py ran `alembic upgrade head`). They assert the post-migration
schema is exactly what the migration promises.

Covers:
- New columns on groups, popups, events, applications
- New tables: invites, referrals
- Indexes on the new tables
- RLS policies for the new tables
- Default values for flag columns
"""

from sqlmodel import Session


class TestGroupsReworkFoundationMigration:
    """Schema assertions for the groups-rework PR-1 DB foundation migration."""

    # -----------------------------------------------------------------------
    # groups table — new flag columns
    # -----------------------------------------------------------------------

    def test_groups_auto_approve_applications_column_exists(
        self, db: Session
    ) -> None:
        """groups.auto_approve_applications must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'groups'
              AND column_name = 'auto_approve_applications'
            """
        ).fetchone()
        assert row is not None, (
            "Column 'auto_approve_applications' not found on groups."
        )
        assert row[1] == "NO", "auto_approve_applications must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"auto_approve_applications must default to false, got: {row[2]}"
        )

    def test_groups_express_checkout_column_exists(self, db: Session) -> None:
        """groups.express_checkout must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'groups'
              AND column_name = 'express_checkout'
            """
        ).fetchone()
        assert row is not None, "Column 'express_checkout' not found on groups."
        assert row[1] == "NO", "express_checkout must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"express_checkout must default to false, got: {row[2]}"
        )

    def test_groups_enable_private_events_column_exists(self, db: Session) -> None:
        """groups.enable_private_events must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'groups'
              AND column_name = 'enable_private_events'
            """
        ).fetchone()
        assert row is not None, "Column 'enable_private_events' not found on groups."
        assert row[1] == "NO", "enable_private_events must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"enable_private_events must default to false, got: {row[2]}"
        )

    # -----------------------------------------------------------------------
    # popups table — new feature flag columns
    # -----------------------------------------------------------------------

    def test_popups_invites_enabled_column_exists(self, db: Session) -> None:
        """popups.invites_enabled must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'popups'
              AND column_name = 'invites_enabled'
            """
        ).fetchone()
        assert row is not None, "Column 'invites_enabled' not found on popups."
        assert row[1] == "NO", "invites_enabled must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"invites_enabled must default to false, got: {row[2]}"
        )

    def test_popups_referrals_enabled_column_exists(self, db: Session) -> None:
        """popups.referrals_enabled must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'popups'
              AND column_name = 'referrals_enabled'
            """
        ).fetchone()
        assert row is not None, "Column 'referrals_enabled' not found on popups."
        assert row[1] == "NO", "referrals_enabled must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"referrals_enabled must default to false, got: {row[2]}"
        )

    def test_popups_group_private_events_enabled_column_exists(
        self, db: Session
    ) -> None:
        """popups.group_private_events_enabled must exist, be NOT NULL, default false."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'popups'
              AND column_name = 'group_private_events_enabled'
            """
        ).fetchone()
        assert row is not None, (
            "Column 'group_private_events_enabled' not found on popups."
        )
        assert row[1] == "NO", "group_private_events_enabled must be NOT NULL"
        assert "false" in (row[2] or "").lower(), (
            f"group_private_events_enabled must default to false, got: {row[2]}"
        )

    # -----------------------------------------------------------------------
    # events table — group_id column and index
    # -----------------------------------------------------------------------

    def test_events_group_id_column_exists(self, db: Session) -> None:
        """events.group_id must exist, be nullable UUID."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_name = 'events'
              AND column_name = 'group_id'
            """
        ).fetchone()
        assert row is not None, "Column 'group_id' not found on events."
        assert row[1] == "YES", "events.group_id must be nullable"
        assert row[2] == "uuid", f"events.group_id must be UUID type, got: {row[2]}"

    def test_events_group_start_index_exists(self, db: Session) -> None:
        """ix_events_group_start partial index must exist on events."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'events'
              AND indexname = 'ix_events_group_start'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_events_group_start' not found on events table."
        )

    # -----------------------------------------------------------------------
    # applications table — invite_id, referral_id columns
    # -----------------------------------------------------------------------

    def test_applications_invite_id_column_exists(self, db: Session) -> None:
        """applications.invite_id must exist, be nullable UUID."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_name = 'applications'
              AND column_name = 'invite_id'
            """
        ).fetchone()
        assert row is not None, "Column 'invite_id' not found on applications."
        assert row[1] == "YES", "applications.invite_id must be nullable"
        assert row[2] == "uuid", (
            f"applications.invite_id must be UUID type, got: {row[2]}"
        )

    def test_applications_referral_id_column_exists(self, db: Session) -> None:
        """applications.referral_id must exist, be nullable UUID."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, data_type
            FROM information_schema.columns
            WHERE table_name = 'applications'
              AND column_name = 'referral_id'
            """
        ).fetchone()
        assert row is not None, "Column 'referral_id' not found on applications."
        assert row[1] == "YES", "applications.referral_id must be nullable"
        assert row[2] == "uuid", (
            f"applications.referral_id must be UUID type, got: {row[2]}"
        )

    def test_applications_invite_id_partial_index_exists(self, db: Session) -> None:
        """ix_applications_invite_id partial index must exist on applications."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'applications'
              AND indexname = 'ix_applications_invite_id'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_applications_invite_id' not found on applications."
        )

    def test_applications_referral_id_partial_index_exists(
        self, db: Session
    ) -> None:
        """ix_applications_referral_id partial index must exist on applications."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'applications'
              AND indexname = 'ix_applications_referral_id'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_applications_referral_id' not found on applications."
        )

    # -----------------------------------------------------------------------
    # invites table — existence, key columns, indexes, RLS
    # -----------------------------------------------------------------------

    def test_invites_table_exists(self, db: Session) -> None:
        """invites table must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'invites'
              AND table_schema = 'public'
            """
        ).fetchone()
        assert row is not None, "Table 'invites' does not exist."

    def test_invites_token_column_exists(self, db: Session) -> None:
        """invites.token must exist and be NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'invites'
              AND column_name = 'token'
            """
        ).fetchone()
        assert row is not None, "Column 'token' not found on invites."
        assert row[1] == "NO", "invites.token must be NOT NULL"

    def test_invites_tenant_id_column_exists(self, db: Session) -> None:
        """invites.tenant_id must exist and be NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'invites'
              AND column_name = 'tenant_id'
            """
        ).fetchone()
        assert row is not None, "Column 'tenant_id' not found on invites."
        assert row[1] == "NO", "invites.tenant_id must be NOT NULL"

    def test_invites_current_uses_not_null(self, db: Session) -> None:
        """invites.current_uses must be NOT NULL with default 0."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'invites'
              AND column_name = 'current_uses'
            """
        ).fetchone()
        assert row is not None, "Column 'current_uses' not found on invites."
        assert row[1] == "NO", "invites.current_uses must be NOT NULL"
        assert row[2] is not None and "0" in str(row[2]), (
            f"invites.current_uses must default to 0, got: {row[2]}"
        )

    def test_invites_popup_token_unique_index_exists(self, db: Session) -> None:
        """uq_invites_popup_token unique index must exist on invites."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'invites'
              AND indexname = 'uq_invites_popup_token'
            """
        ).fetchone()
        assert row is not None, (
            "Unique index 'uq_invites_popup_token' not found on invites."
        )

    def test_invites_legacy_migrated_partial_unique_index_exists(
        self, db: Session
    ) -> None:
        """uq_invites_legacy_group_id partial unique index must exist on invites."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'invites'
              AND indexname = 'uq_invites_legacy_group_id'
            """
        ).fetchone()
        assert row is not None, (
            "Partial unique index 'uq_invites_legacy_group_id' not found on invites."
        )

    def test_invites_rls_policy_exists(self, db: Session) -> None:
        """RLS policy tenant_isolation_policy_invites must exist on invites."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT policyname
            FROM pg_policies
            WHERE tablename = 'invites'
              AND schemaname = 'public'
              AND policyname = 'tenant_isolation_policy_invites'
            """
        ).fetchone()
        assert row is not None, (
            "RLS policy 'tenant_isolation_policy_invites' not found on invites. "
            "add_tenant_table_permissions('invites') was not called."
        )

    # -----------------------------------------------------------------------
    # referrals table — existence, key columns, indexes, RLS
    # -----------------------------------------------------------------------

    def test_referrals_table_exists(self, db: Session) -> None:
        """referrals table must exist."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_name = 'referrals'
              AND table_schema = 'public'
            """
        ).fetchone()
        assert row is not None, "Table 'referrals' does not exist."

    def test_referrals_code_column_exists(self, db: Session) -> None:
        """referrals.code must exist and be NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'referrals'
              AND column_name = 'code'
            """
        ).fetchone()
        assert row is not None, "Column 'code' not found on referrals."
        assert row[1] == "NO", "referrals.code must be NOT NULL"

    def test_referrals_referrer_human_id_not_null(self, db: Session) -> None:
        """referrals.referrer_human_id must exist and be NOT NULL."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'referrals'
              AND column_name = 'referrer_human_id'
            """
        ).fetchone()
        assert row is not None, "Column 'referrer_human_id' not found on referrals."
        assert row[1] == "NO", "referrals.referrer_human_id must be NOT NULL"

    def test_referrals_current_uses_not_null(self, db: Session) -> None:
        """referrals.current_uses must be NOT NULL with default 0."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'referrals'
              AND column_name = 'current_uses'
            """
        ).fetchone()
        assert row is not None, "Column 'current_uses' not found on referrals."
        assert row[1] == "NO", "referrals.current_uses must be NOT NULL"
        assert row[2] is not None and "0" in str(row[2]), (
            f"referrals.current_uses must default to 0, got: {row[2]}"
        )

    def test_referrals_popup_code_unique_index_exists(self, db: Session) -> None:
        """uq_referrals_popup_code unique index must exist on referrals."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'referrals'
              AND indexname = 'uq_referrals_popup_code'
            """
        ).fetchone()
        assert row is not None, (
            "Unique index 'uq_referrals_popup_code' not found on referrals."
        )

    def test_referrals_referrer_human_id_index_exists(self, db: Session) -> None:
        """ix_referrals_referrer_human_id index must exist on referrals."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE tablename = 'referrals'
              AND indexname = 'ix_referrals_referrer_human_id'
            """
        ).fetchone()
        assert row is not None, (
            "Index 'ix_referrals_referrer_human_id' not found on referrals."
        )

    def test_referrals_rls_policy_exists(self, db: Session) -> None:
        """RLS policy tenant_isolation_policy_referrals must exist on referrals."""
        conn = db.connection()
        row = conn.exec_driver_sql(
            """
            SELECT policyname
            FROM pg_policies
            WHERE tablename = 'referrals'
              AND schemaname = 'public'
              AND policyname = 'tenant_isolation_policy_referrals'
            """
        ).fetchone()
        assert row is not None, (
            "RLS policy 'tenant_isolation_policy_referrals' not found on referrals. "
            "add_tenant_table_permissions('referrals') was not called."
        )
