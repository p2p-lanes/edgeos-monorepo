"""Tests for the _backfill_legacy data migration (bfaabd563367_groups_rework, PR-7).

These tests verify T-gr-045 (backfill implementation) and T-gr-048 (migration tests).

Strategy:
  - The test DB is already at `head` (conftest.py ran alembic upgrade head).
  - Each test gets a fresh engine.begin() transaction.
  - We seed synthetic EE26-like groups, run _backfill_legacy(), then assert.
  - Transaction is rolled back after each test for clean isolation.
  - All operations (seed + backfill + assert) happen on the same raw connection.

Spec: REQ-GR-023 (three-bucket classification), REQ-GR-024 (idempotency).
Design: Migration Plan → _backfill_legacy helper.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import Engine, text

# Import the backfill helper directly for unit-testing without running alembic
from app.alembic.versions.bfaabd563367_groups_rework import _backfill_legacy
from app.api.shared.enums import UserRole

# EE26 popup id used in the migration
_EE26_POPUP_ID = "43746fd0-bce2-472b-93e4-a438177b2dff"


def _seed_tenant(conn) -> str:  # noqa: ANN001
    """Create a synthetic tenant."""
    tenant_id = str(uuid.uuid4())
    conn.execute(
        text("""
            INSERT INTO tenants (id, name, slug)
            VALUES (:id, :name, :slug)
        """),
        {
            "id": tenant_id,
            "name": f"EE26 Tenant {tenant_id[:6]}",
            "slug": f"ee26-{tenant_id[:8]}",
        },
    )
    return tenant_id


def _seed_popup(conn, tenant_id: str) -> None:  # noqa: ANN001
    """Ensure the EE26 popup exists with the hardcoded id."""
    existing = conn.execute(
        text("SELECT id FROM popups WHERE id = :id"),
        {"id": _EE26_POPUP_ID},
    ).fetchone()
    if existing:
        return

    slug = f"ee26-popup-{uuid.uuid4().hex[:6]}"
    conn.execute(
        text("""
            INSERT INTO popups (id, tenant_id, name, slug, status, invites_enabled)
            VALUES (:id, :tenant_id, 'EE26 Popup', :slug, 'active', true)
        """),
        {"id": _EE26_POPUP_ID, "tenant_id": tenant_id, "slug": slug},
    )


def _seed_admin_user(conn, tenant_id: str) -> str:  # noqa: ANN001
    """Create an admin user for the tenant."""
    user_id = str(uuid.uuid4())
    conn.execute(
        text("""
            INSERT INTO users (id, tenant_id, email, role, deleted, auth_attempts)
            VALUES (:id, :tenant_id, :email, :role, false, 0)
        """),
        {
            "id": user_id,
            "tenant_id": tenant_id,
            "email": f"admin-{user_id[:6]}@ee26.test",
            "role": UserRole.ADMIN.value,
        },
    )
    return user_id


def _seed_human(conn, tenant_id: str) -> str:  # noqa: ANN001
    """Create a test human."""
    human_id = str(uuid.uuid4())
    conn.execute(
        text("""
            INSERT INTO humans (id, tenant_id, email, first_name, last_name)
            VALUES (:id, :tenant_id, :email, 'Test', 'Human')
        """),
        {"id": human_id, "tenant_id": tenant_id, "email": f"h-{human_id[:6]}@test.com"},
    )
    return human_id


def _seed_bucket_a_group(
    conn,  # noqa: ANN001
    tenant_id: str,
    *,
    with_application: bool = False,
    human_id: str | None = None,
) -> tuple[str, str | None]:
    """Seed a Bucket A (ee26-bulk, max_members=1) group."""
    group_id = str(uuid.uuid4())
    slug = f"ee26-bulk-{uuid.uuid4().hex[:12]}"
    conn.execute(
        text("""
            INSERT INTO groups (id, tenant_id, popup_id, name, slug,
                                max_members, is_ambassador_group,
                                auto_approve_applications, express_checkout,
                                enable_private_events, discount_percentage,
                                created_at, updated_at)
            VALUES (:id, :tenant_id, :popup_id, :name, :slug,
                    1, false, false, false, false, 10.00, now(), now())
        """),
        {
            "id": group_id,
            "tenant_id": tenant_id,
            "popup_id": _EE26_POPUP_ID,
            "name": f"ee26-bulk-name-{group_id[:8]}",
            "slug": slug,
        },
    )

    app_id = None
    if with_application and human_id:
        app_id = str(uuid.uuid4())
        conn.execute(
            text("""
                INSERT INTO applications (id, tenant_id, popup_id, group_id,
                    human_id, status, created_at, updated_at)
                VALUES (:id, :tenant_id, :popup_id, :group_id,
                    :human_id, 'ACCEPTED', now(), now())
            """),
            {
                "id": app_id,
                "tenant_id": tenant_id,
                "popup_id": _EE26_POPUP_ID,
                "group_id": group_id,
                "human_id": human_id,
            },
        )

    return group_id, app_id


def _seed_bucket_b_group(
    conn,  # noqa: ANN001
    tenant_id: str,
    *,
    human_ids: list[str] | None = None,
) -> tuple[str, list[str]]:
    """Seed a Bucket B (masivos, max_members=NULL) group."""
    group_id = str(uuid.uuid4())
    slug = f"masivo-{uuid.uuid4().hex[:8]}"
    conn.execute(
        text("""
            INSERT INTO groups (id, tenant_id, popup_id, name, slug,
                                max_members, is_ambassador_group,
                                auto_approve_applications, express_checkout,
                                enable_private_events, discount_percentage,
                                created_at, updated_at)
            VALUES (:id, :tenant_id, :popup_id, :name, :slug,
                    NULL, false, false, false, false, 5.00, now(), now())
        """),
        {
            "id": group_id,
            "tenant_id": tenant_id,
            "popup_id": _EE26_POPUP_ID,
            "name": f"masivo-invites-{slug}",
            "slug": slug,
        },
    )

    app_ids = []
    for hid in human_ids or []:
        app_id = str(uuid.uuid4())
        conn.execute(
            text("""
                INSERT INTO applications (id, tenant_id, popup_id, group_id,
                    human_id, status, created_at, updated_at)
                VALUES (:id, :tenant_id, :popup_id, :group_id,
                    :human_id, 'ACCEPTED', now(), now())
            """),
            {
                "id": app_id,
                "tenant_id": tenant_id,
                "popup_id": _EE26_POPUP_ID,
                "group_id": group_id,
                "human_id": hid,
            },
        )
        app_ids.append(app_id)

    return group_id, app_ids


def _seed_bucket_c_group(conn, tenant_id: str, popup_id: str | None = None) -> str:  # noqa: ANN001
    """Seed a Bucket C (residency, max_members > 1) group."""
    group_id = str(uuid.uuid4())
    slug = f"residency-{uuid.uuid4().hex[:8]}"
    conn.execute(
        text("""
            INSERT INTO groups (id, tenant_id, popup_id, name, slug,
                                max_members, is_ambassador_group,
                                auto_approve_applications, express_checkout,
                                enable_private_events, discount_percentage,
                                created_at, updated_at)
            VALUES (:id, :tenant_id, :popup_id, :name, :slug,
                    50, false, false, false, false, 100.00, now(), now())
        """),
        {
            "id": group_id,
            "tenant_id": tenant_id,
            "popup_id": popup_id or _EE26_POPUP_ID,
            "name": f"Residency Group {slug}",
            "slug": slug,
        },
    )
    return group_id


# ---------------------------------------------------------------------------
# Fixtures — each test gets a fresh transaction, rolled back after
# ---------------------------------------------------------------------------


@pytest.fixture()
def ee26_conn(test_engine: Engine):  # type: ignore[name-defined]
    """Provide a transactional connection for backfill tests.

    Seeds a minimal EE26-like environment within the transaction.
    All operations (seed + backfill + assert) run on this single connection.
    Transaction is rolled back after the test for clean isolation.
    """
    with test_engine.begin() as conn:
        tenant_id = _seed_tenant(conn)
        _seed_popup(conn, tenant_id)
        admin_id = _seed_admin_user(conn, tenant_id)
        # Set a SAVEPOINT so we can roll back the test-specific data
        conn.execute(text("SAVEPOINT sp_test"))
        yield {"tenant_id": tenant_id, "admin_id": admin_id, "conn": conn}
        # Roll back to before test-specific data
        conn.execute(text("ROLLBACK TO SAVEPOINT sp_test"))
        conn.execute(text("SAVEPOINT sp_test"))  # reset for potential cleanup
        # The outer with block will then rollback the whole transaction


# ---------------------------------------------------------------------------
# Tests — T-gr-048
# ---------------------------------------------------------------------------


class TestBackfillLegacyBucketA:
    """Bucket A: bulk single-use groups → invites.

    Spec: REQ-GR-023, REQ-GR-024
    """

    def test_bucket_a_group_without_application_creates_invite(
        self, ee26_conn: dict
    ) -> None:
        """Bucket A group with no application → Invite with current_uses=0."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id, _ = _seed_bucket_a_group(conn, tenant_id, with_application=False)

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT max_uses, current_uses, used_at, redeemed_by_human_id
                FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None, "No invite created for Bucket A group"
        assert row.max_uses == 1
        assert row.current_uses == 0
        assert row.used_at is None
        assert row.redeemed_by_human_id is None

    def test_bucket_a_group_with_application_preserves_usage(
        self, ee26_conn: dict
    ) -> None:
        """Bucket A group with 1 application → Invite with current_uses=1, used_at set."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        group_id, app_id = _seed_bucket_a_group(
            conn, tenant_id, with_application=True, human_id=human_id
        )

        _backfill_legacy(conn)

        inv_row = conn.execute(
            text("""
                SELECT max_uses, current_uses, used_at, redeemed_by_human_id
                FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert inv_row is not None
        assert inv_row.max_uses == 1
        assert inv_row.current_uses == 1
        assert inv_row.used_at is not None
        assert str(inv_row.redeemed_by_human_id) == human_id

    def test_bucket_a_application_invite_id_backfilled(self, ee26_conn: dict) -> None:
        """applications.invite_id is backfilled for Bucket A groups."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        group_id, app_id = _seed_bucket_a_group(
            conn, tenant_id, with_application=True, human_id=human_id
        )
        assert app_id is not None

        _backfill_legacy(conn)

        app_row = conn.execute(
            text("SELECT invite_id FROM applications WHERE id = :app_id"),
            {"app_id": app_id},
        ).fetchone()
        assert app_row is not None
        assert app_row.invite_id is not None

        inv_row = conn.execute(
            text("""
                SELECT id FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()
        assert str(app_row.invite_id) == str(inv_row.id)


class TestBackfillLegacyBucketB:
    """Bucket B: masivos multi-use groups → invites.

    Spec: REQ-GR-023 Bucket B
    """

    def test_bucket_b_creates_multi_use_invite(self, ee26_conn: dict) -> None:
        """Masivos group creates invite with max_uses=NULL and correct current_uses."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        h1 = _seed_human(conn, tenant_id)
        h2 = _seed_human(conn, tenant_id)

        group_id, _ = _seed_bucket_b_group(conn, tenant_id, human_ids=[h1, h2])

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT max_uses, current_uses
                FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None
        assert row.max_uses is None
        assert row.current_uses == 2

    def test_bucket_b_all_applications_backfilled(self, ee26_conn: dict) -> None:
        """All applications for masivos group get invite_id backfilled."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        h1 = _seed_human(conn, tenant_id)
        h2 = _seed_human(conn, tenant_id)

        group_id, app_ids = _seed_bucket_b_group(conn, tenant_id, human_ids=[h1, h2])

        _backfill_legacy(conn)

        for app_id in app_ids:
            row = conn.execute(
                text("SELECT invite_id FROM applications WHERE id = :id"),
                {"id": app_id},
            ).fetchone()
            assert row.invite_id is not None


class TestBackfillLegacyBucketC:
    """Bucket C: residency groups → in-place flag update.

    Spec: REQ-GR-023 Bucket C
    """

    def test_bucket_c_flags_set(self, ee26_conn: dict) -> None:
        """Residency group gets auto_approve_applications=true, express_checkout=true."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_bucket_c_group(conn, tenant_id)

        before = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": group_id},
        ).fetchone()
        assert before.auto_approve_applications is False
        assert before.express_checkout is False

        _backfill_legacy(conn)

        after = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": group_id},
        ).fetchone()
        assert after.auto_approve_applications is True
        assert after.express_checkout is True

    def test_bucket_c_no_invite_created(self, ee26_conn: dict) -> None:
        """Residency group must NOT create an invite row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_bucket_c_group(conn, tenant_id)

        _backfill_legacy(conn)

        row = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert row is None, "Bucket C should NOT create an invite"


class TestBackfillLegacyIdempotency:
    """Spec: REQ-GR-024 — migration must be idempotent."""

    def test_second_run_is_noop_for_bucket_a(self, ee26_conn: dict) -> None:
        """Running backfill twice for Bucket A produces same row count (= 1)."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id, _ = _seed_bucket_a_group(conn, tenant_id, with_application=False)

        _backfill_legacy(conn)
        count1 = conn.execute(
            text(
                "SELECT COUNT(*) FROM invites WHERE legacy_migrated_from_group_id = :gid"
            ),
            {"gid": group_id},
        ).scalar()

        _backfill_legacy(conn)
        count2 = conn.execute(
            text(
                "SELECT COUNT(*) FROM invites WHERE legacy_migrated_from_group_id = :gid"
            ),
            {"gid": group_id},
        ).scalar()

        assert count1 == count2 == 1

    def test_second_run_is_noop_for_bucket_c(self, ee26_conn: dict) -> None:
        """Running backfill twice for Bucket C leaves flags unchanged at true."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_bucket_c_group(conn, tenant_id)

        _backfill_legacy(conn)
        _backfill_legacy(conn)

        after = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": group_id},
        ).fetchone()
        assert after.auto_approve_applications is True
        assert after.express_checkout is True


class TestBackfillLegacyScopeIsolation:
    """Non-EE26 groups must NOT be affected by _backfill_legacy."""

    def test_non_ee26_group_not_migrated(self, ee26_conn: dict) -> None:
        """A group with a different popup_id is untouched."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        # Create a completely separate popup (not EE26)
        other_popup_id = str(uuid.uuid4())
        conn.execute(
            text("""
                INSERT INTO popups (id, tenant_id, name, slug, status)
                VALUES (:id, :tenant_id, 'Other Popup', :slug, 'draft')
            """),
            {
                "id": other_popup_id,
                "tenant_id": tenant_id,
                "slug": f"other-{uuid.uuid4().hex[:6]}",
            },
        )

        # Seed a group that looks like Bucket C but belongs to the other popup
        other_group_id = _seed_bucket_c_group(conn, tenant_id, popup_id=other_popup_id)

        _backfill_legacy(conn)

        row = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": other_group_id},
        ).fetchone()
        assert row.auto_approve_applications is False
        assert row.express_checkout is False

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": other_group_id},
        ).fetchone()
        assert inv is None
