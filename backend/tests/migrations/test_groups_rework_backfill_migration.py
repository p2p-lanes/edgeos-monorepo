"""Tests for the _backfill_legacy data migration (bfaabd563367_groups_rework, PR-7).

These tests verify T-gr-045 (backfill implementation) and T-gr-048 (migration tests).

Taxonomy validated against prod popup 43746fd0-bce2-472b-93e4-a438177b2dff (June 2026):
  Rule 1 — REFERRAL: is_ambassador_group=true (1 row) → referrals
  Rule 2 — INVITE bulk: name LIKE 'EE26 invite — %' AND max_members=10 (16,899 rows) → invites
  Rule 3 — INVITE named: NOT bulk AND (name ILIKE '%invite%' OR '%link%') (6 rows) → invites
  Rule 4 — GROUP residency: NOT above AND name ILIKE '%residency%' (7 rows) → stay as groups
  Rule 5 — GROUP leftover: everything else (1 row) → stay as groups

Strategy:
  - The test DB is already at `head` (conftest.py ran alembic upgrade head).
  - Each test gets a fresh engine.begin() transaction.
  - We seed synthetic EE26-like groups for each rule, run _backfill_legacy(), then assert.
  - Transaction is rolled back after each test for clean isolation.
  - All operations (seed + backfill + assert) happen on the same raw connection.

Spec: REQ-GR-023 (five-rule classification), REQ-GR-024 (idempotency).
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

# Em-dash prefix (U+2014) — must match the migration constant exactly
_EE26_INVITE_PREFIX = "EE26 invite — "


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


def _seed_application(
    conn,  # noqa: ANN001
    tenant_id: str,
    group_id: str,
    human_id: str,
) -> str:
    """Create an application linked to a group."""
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
    return app_id


def _seed_group(
    conn,  # noqa: ANN001
    tenant_id: str,
    *,
    name: str,
    slug: str,
    max_members: int | None,
    is_ambassador_group: bool = False,
    ambassador_id: str | None = None,
    discount_percentage: float = 0.0,
    popup_id: str = _EE26_POPUP_ID,
) -> str:
    """Generic group seed helper."""
    group_id = str(uuid.uuid4())
    conn.execute(
        text("""
            INSERT INTO groups (id, tenant_id, popup_id, name, slug,
                                max_members, is_ambassador_group, ambassador_id,
                                auto_approve_applications, express_checkout,
                                enable_private_events, discount_percentage,
                                created_at, updated_at)
            VALUES (:id, :tenant_id, :popup_id, :name, :slug,
                    :max_members, :is_ambassador_group, :ambassador_id,
                    false, false, false, :discount_percentage, now(), now())
        """),
        {
            "id": group_id,
            "tenant_id": tenant_id,
            "popup_id": popup_id,
            "name": name,
            "slug": slug,
            "max_members": max_members,
            "is_ambassador_group": is_ambassador_group,
            "ambassador_id": ambassador_id,
            "discount_percentage": discount_percentage,
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
# Rule 1: Ambassador groups → referrals
# ---------------------------------------------------------------------------


class TestBackfillRule1Referral:
    """Rule 1: is_ambassador_group=true → INSERT INTO referrals.

    Spec: REQ-GR-023 Rule 1, REQ-GR-024 (idempotency).
    """

    def test_ambassador_group_creates_referral(self, ee26_conn: dict) -> None:
        """Ambassador group with ambassador_id → referrals row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        _seed_group(
            conn,
            tenant_id,
            name="Bill Martin Invite List",
            slug=f"bill-martin-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=True,
            ambassador_id=human_id,
            discount_percentage=10.0,
        )

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT referrer_human_id, code, discount_percentage
                FROM referrals
                WHERE popup_id = :popup_id
                  AND referrer_human_id = :human_id
            """),
            {"popup_id": _EE26_POPUP_ID, "human_id": human_id},
        ).fetchone()

        assert row is not None, "No referral created for ambassador group"
        assert str(row.referrer_human_id) == human_id

    def test_ambassador_group_without_ambassador_id_skipped(
        self, ee26_conn: dict
    ) -> None:
        """Ambassador group with ambassador_id=NULL is skipped (no referral created)."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        _seed_group(
            conn,
            tenant_id,
            name="Orphan Ambassador Group",
            slug=f"orphan-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=True,
            ambassador_id=None,
        )

        _backfill_legacy(conn)

        count = conn.execute(
            text("SELECT COUNT(*) FROM referrals WHERE popup_id = :popup_id"),
            {"popup_id": _EE26_POPUP_ID},
        ).scalar()

        assert count == 0, (
            "No referral should be created for an ambassador group without ambassador_id"
        )

    def test_ambassador_group_idempotent(self, ee26_conn: dict) -> None:
        """Running backfill twice for Rule 1 produces exactly 1 referral row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        _seed_group(
            conn,
            tenant_id,
            name="Bill Martin Invite List",
            slug=f"bill-martin-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=True,
            ambassador_id=human_id,
        )

        _backfill_legacy(conn)
        _backfill_legacy(conn)

        count = conn.execute(
            text("SELECT COUNT(*) FROM referrals WHERE popup_id = :popup_id"),
            {"popup_id": _EE26_POPUP_ID},
        ).scalar()

        assert count == 1, f"Expected 1 referral after 2 runs, got {count}"

    def test_ambassador_group_not_converted_to_invite(self, ee26_conn: dict) -> None:
        """Ambassador group must NOT produce an invite row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Bill Martin Invite List",
            slug=f"bill-martin-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=True,
            ambassador_id=human_id,
        )

        _backfill_legacy(conn)

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert inv is None, "Ambassador group must NOT create an invite"


# ---------------------------------------------------------------------------
# Rule 2: Bulk invite groups → multi-use invites (max_uses=10, batched)
# ---------------------------------------------------------------------------


class TestBackfillRule2BulkInvites:
    """Rule 2: name LIKE 'EE26 invite — %' AND max_members=10 → invites.

    Spec: REQ-GR-023 Rule 2, REQ-GR-024 (idempotency).
    """

    def test_bulk_group_without_application_creates_invite(
        self, ee26_conn: dict
    ) -> None:
        """Bulk group with no application → Invite with current_uses=0."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}{uuid.uuid4().hex[:8]}",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
            discount_percentage=5.0,
        )

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT max_uses, current_uses, used_at, redeemed_by_human_id
                FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None, "No invite created for bulk invite group"
        assert row.max_uses == 10
        assert row.current_uses == 0
        assert row.used_at is None
        assert row.redeemed_by_human_id is None

    def test_bulk_group_with_application_preserves_usage(self, ee26_conn: dict) -> None:
        """Bulk group with 1 application → Invite with current_uses=1, used_at set."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}{uuid.uuid4().hex[:8]}",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
        )
        _seed_application(conn, tenant_id, group_id, human_id)

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT max_uses, current_uses, used_at, redeemed_by_human_id
                FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None
        assert row.max_uses == 10
        assert row.current_uses == 1
        assert row.used_at is not None
        assert str(row.redeemed_by_human_id) == human_id

    def test_bulk_group_application_invite_id_backfilled(self, ee26_conn: dict) -> None:
        """applications.invite_id is backfilled for Rule 2 groups."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}{uuid.uuid4().hex[:8]}",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
        )
        app_id = _seed_application(conn, tenant_id, group_id, human_id)

        _backfill_legacy(conn)

        app_row = conn.execute(
            text("SELECT invite_id FROM applications WHERE id = :id"),
            {"id": app_id},
        ).fetchone()
        assert app_row is not None
        assert app_row.invite_id is not None

        inv_row = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert str(app_row.invite_id) == str(inv_row.id)

    def test_bulk_group_idempotent(self, ee26_conn: dict) -> None:
        """Running backfill twice for Rule 2 produces exactly 1 invite row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}{uuid.uuid4().hex[:8]}",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)
        _backfill_legacy(conn)

        count = conn.execute(
            text(
                "SELECT COUNT(*) FROM invites WHERE legacy_migrated_from_group_id = :gid"
            ),
            {"gid": group_id},
        ).scalar()

        assert count == 1, f"Expected 1 invite after 2 runs, got {count}"

    def test_bulk_group_not_treated_as_referral_or_residency(
        self, ee26_conn: dict
    ) -> None:
        """Bulk invite group must NOT affect referrals table or group flags."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}{uuid.uuid4().hex[:8]}",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        ref_count = conn.execute(
            text("SELECT COUNT(*) FROM referrals WHERE popup_id = :popup_id"),
            {"popup_id": _EE26_POPUP_ID},
        ).scalar()
        assert ref_count == 0

        flags = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": group_id},
        ).fetchone()
        assert flags.auto_approve_applications is False
        assert flags.express_checkout is False


# ---------------------------------------------------------------------------
# Rule 3: Named invite groups → multi-use invites
# ---------------------------------------------------------------------------


class TestBackfillRule3NamedInvites:
    """Rule 3: NOT bulk AND (name ILIKE '%invite%' OR '%link%') → invites max_uses=NULL.

    Spec: REQ-GR-023 Rule 3.
    """

    def test_named_invite_group_creates_multi_use_invite(self, ee26_conn: dict) -> None:
        """Named invite group creates invite with max_uses=NULL and correct current_uses."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        h1 = _seed_human(conn, tenant_id)
        h2 = _seed_human(conn, tenant_id)

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Dawn Invites",
            slug=f"dawn-invites-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )
        _seed_application(conn, tenant_id, group_id, h1)
        _seed_application(conn, tenant_id, group_id, h2)

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

    def test_named_link_group_creates_invite(self, ee26_conn: dict) -> None:
        """A group with 'link' in name (not 'invite', not bulk prefix) → invite."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Meditation Artifacts Link",
            slug=f"meditation-link-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT id, max_uses FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None, "Link-named group should create an invite"
        assert row.max_uses is None

    def test_named_invite_all_applications_backfilled(self, ee26_conn: dict) -> None:
        """All applications for named invite group get invite_id backfilled."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        h1 = _seed_human(conn, tenant_id)
        h2 = _seed_human(conn, tenant_id)

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Vibecode Invites",
            slug=f"vibecode-invites-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )
        app1 = _seed_application(conn, tenant_id, group_id, h1)
        app2 = _seed_application(conn, tenant_id, group_id, h2)

        _backfill_legacy(conn)

        for app_id in [app1, app2]:
            row = conn.execute(
                text("SELECT invite_id FROM applications WHERE id = :id"),
                {"id": app_id},
            ).fetchone()
            assert row.invite_id is not None, (
                f"invite_id not backfilled for app {app_id}"
            )

    def test_named_invite_idempotent(self, ee26_conn: dict) -> None:
        """Running backfill twice for Rule 3 produces exactly 1 invite row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Hanna Prelle Invites",
            slug=f"hanna-invites-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)
        _backfill_legacy(conn)

        count = conn.execute(
            text(
                "SELECT COUNT(*) FROM invites WHERE legacy_migrated_from_group_id = :gid"
            ),
            {"gid": group_id},
        ).scalar()

        assert count == 1, f"Expected 1 invite after 2 runs, got {count}"


# ---------------------------------------------------------------------------
# Rule 4: Residency groups → stay as groups (no conversion)
# ---------------------------------------------------------------------------


class TestBackfillRule4Residency:
    """Rule 4: name ILIKE '%residency%' (and not invite/link/ambassador) → no-op.

    Spec: REQ-GR-023 Rule 4.
    """

    def test_residency_group_not_converted(self, ee26_conn: dict) -> None:
        """Residency group must NOT create an invite or referral row."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Uniswap Residency",
            slug=f"uniswap-residency-{uuid.uuid4().hex[:6]}",
            max_members=23,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert inv is None, "Residency group must NOT create an invite"

        ref_count = conn.execute(
            text("SELECT COUNT(*) FROM referrals WHERE popup_id = :popup_id"),
            {"popup_id": _EE26_POPUP_ID},
        ).scalar()
        assert ref_count == 0, "Residency group must NOT create a referral"

    def test_residency_group_flags_unchanged(self, ee26_conn: dict) -> None:
        """Residency group flags must NOT be mutated by the migration."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Zee Prime Residency",
            slug=f"zee-prime-residency-{uuid.uuid4().hex[:6]}",
            max_members=15,
            is_ambassador_group=False,
        )

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
        # Flags must remain unchanged (NOT set to true like the old Bucket C did)
        assert after.auto_approve_applications is False
        assert after.express_checkout is False


# ---------------------------------------------------------------------------
# Rule 5: Leftover groups → stay as groups (no-op)
# ---------------------------------------------------------------------------


class TestBackfillRule5Leftover:
    """Rule 5: groups not matching any other rule → no-op.

    Spec: REQ-GR-023 Rule 5.
    """

    def test_leftover_group_not_converted(self, ee26_conn: dict) -> None:
        """A group like 'Supernuclear' (no invite/link/residency/ambassador) → untouched."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        group_id = _seed_group(
            conn,
            tenant_id,
            name="Supernuclear",
            slug=f"supernuclear-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert inv is None

        flags = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": group_id},
        ).fetchone()
        assert flags.auto_approve_applications is False
        assert flags.express_checkout is False


# ---------------------------------------------------------------------------
# Priority / mutual-exclusion tests — rules are applied in order
# ---------------------------------------------------------------------------


class TestBackfillRulePriority:
    """Verify rules are mutually exclusive: each group matches at most one rule."""

    def test_ambassador_with_invite_in_name_routes_to_referral(
        self, ee26_conn: dict
    ) -> None:
        """is_ambassador_group=true takes Rule 1 priority over invite name patterns."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]
        human_id = _seed_human(conn, tenant_id)

        # name contains 'invite' BUT is_ambassador_group=true → Rule 1 wins
        group_id = _seed_group(
            conn,
            tenant_id,
            name="Bill's Invite Ambassador Group",
            slug=f"bill-invite-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=True,
            ambassador_id=human_id,
        )

        _backfill_legacy(conn)

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": group_id},
        ).fetchone()
        assert inv is None, "Rule 1 (ambassador) must take priority — no invite created"

        ref_count = conn.execute(
            text("SELECT COUNT(*) FROM referrals WHERE popup_id = :popup_id"),
            {"popup_id": _EE26_POPUP_ID},
        ).scalar()
        assert ref_count == 1, "Rule 1 must create a referral row"

    def test_bulk_prefix_takes_priority_over_named_invite(
        self, ee26_conn: dict
    ) -> None:
        """'EE26 invite — ...' prefix (Rule 2) takes priority over generic 'invite' match (Rule 3)."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        # Name starts with the bulk prefix AND contains 'invite' implicitly — Rule 2
        group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}xyzinvite",
            slug=f"ee26-inv-{uuid.uuid4().hex[:10]}",
            max_members=10,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        row = conn.execute(
            text("""
                SELECT max_uses FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()

        assert row is not None, "Must create an invite"
        assert row.max_uses == 10, (
            "Rule 2 (bulk) must set max_uses=10, not NULL (Rule 3)"
        )

    def test_residency_with_invite_in_name_does_not_exist_but_rule3_would_win(
        self, ee26_conn: dict
    ) -> None:
        """If a group has both 'invite' and 'residency' in name, Rule 3 fires first."""
        conn = ee26_conn["conn"]
        tenant_id = ee26_conn["tenant_id"]

        # Rules are checked in order: Rule 3 (invite) fires before Rule 4 (residency)
        group_id = _seed_group(
            conn,
            tenant_id,
            name="Residency Invites",
            slug=f"residency-invites-{uuid.uuid4().hex[:6]}",
            max_members=None,
            is_ambassador_group=False,
        )

        _backfill_legacy(conn)

        # Rule 3 should fire (has 'invite' in name) → creates invite
        row = conn.execute(
            text("""
                SELECT id, max_uses FROM invites
                WHERE legacy_migrated_from_group_id = :gid
            """),
            {"gid": group_id},
        ).fetchone()
        assert row is not None, (
            "Rule 3 (invite name) should fire before Rule 4 (residency)"
        )
        assert row.max_uses is None


# ---------------------------------------------------------------------------
# Scope isolation — non-EE26 groups untouched
# ---------------------------------------------------------------------------


class TestBackfillScopeIsolation:
    """Non-EE26 groups must NOT be affected by _backfill_legacy."""

    def test_non_ee26_group_not_migrated(self, ee26_conn: dict) -> None:
        """A group with a different popup_id is untouched regardless of name pattern."""
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

        # Group that LOOKS like Bucket A but belongs to a different popup
        other_group_id = _seed_group(
            conn,
            tenant_id,
            name=f"{_EE26_INVITE_PREFIX}should-not-migrate",
            slug=f"ee26-inv-other-{uuid.uuid4().hex[:8]}",
            max_members=10,
            is_ambassador_group=False,
            popup_id=other_popup_id,
        )

        _backfill_legacy(conn)

        inv = conn.execute(
            text("SELECT id FROM invites WHERE legacy_migrated_from_group_id = :gid"),
            {"gid": other_group_id},
        ).fetchone()
        assert inv is None, "Group in non-EE26 popup must not be migrated"

        flags = conn.execute(
            text(
                "SELECT auto_approve_applications, express_checkout FROM groups WHERE id = :id"
            ),
            {"id": other_group_id},
        ).fetchone()
        assert flags.auto_approve_applications is False
        assert flags.express_checkout is False
