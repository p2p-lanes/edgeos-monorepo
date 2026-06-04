"""Groups rework — DB foundation for invite/referral split + group-private events.

Adds new feature-flag columns to groups, popups, events, and applications.
Creates the invites and referrals tables with RLS.
Includes _backfill_legacy() to migrate ~16,914 EE26 rows into the new model.

EventVisibility enum unchanged — group-scoped privacy uses PRIVATE + group_id IS NOT NULL;
no ALTER on the visibility column. The EventVisibility Python enum stays at exactly
{PUBLIC, UNLISTED, PRIVATE}.

Revision ID: bfaabd563367
Revises: d4b1e7a9c2f5

--- Legacy data migration (PR-7, revised) ---

EE26 popup_id: 43746fd0-bce2-472b-93e4-a438177b2dff
Validated against prod: 16,914 total groups.

Five-rule taxonomy (applied in PRIORITY ORDER — each rule is mutually exclusive):

  1. REFERRAL  — is_ambassador_group = true
                 → 1 row ("Bill Martin Invite List").
                 → INSERT INTO referrals using ambassador_id as referrer_human_id.

  2. INVITE (bulk) — is_ambassador_group = false
                     AND name LIKE 'EE26 invite — %'  (em-dash U+2014)
                     AND max_members = 10
                 → 16,899 rows.
                 → INSERT INTO invites with max_uses=10, batched 500/iter.

  3. INVITE (named) — is_ambassador_group = false
                      AND name NOT LIKE 'EE26 invite — %'
                      AND (name ILIKE '%invite%' OR name ILIKE '%link%')
                 → 6 rows (Dawn Invites, Direct Invites, Hanna Prelle Invites,
                   Mariella Invites, Meditation Artifacts Link, Vibecode Invites).
                 → INSERT INTO invites with max_uses=NULL.

  4. GROUP (residency) — is_ambassador_group = false
                         AND name NOT LIKE 'EE26 invite — %'
                         AND name NOT ILIKE '%invite%'
                         AND name NOT ILIKE '%link%'
                         AND name ILIKE '%residency%'
                 → 7 rows. STAY as groups — no conversion, no flag mutation.

  5. GROUP (leftover) — everything else not matched above.
                 → 1 row ("Supernuclear"). STAY as groups — no action.

Totals: 1 referral + 16,905 invites + 8 groups left as-is = 16,914.

Idempotency for invites: INSERT ... ON CONFLICT (legacy_migrated_from_group_id) DO NOTHING
(partial unique index uq_invites_legacy_group_id created in schema block above).
Idempotency for referrals: INSERT ... ON CONFLICT (popup_id, code) DO NOTHING.

NOTE: The prior implementation used `name ~* '^ee26-bulk-'` and `max_members=1` which
matched 0 rows in prod. The corrected filter uses the literal em-dash separator and
max_members=10, validated against prod snapshot (June 2026).
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# EE26 popup constant — scoped to this migration only
_EE26_POPUP_ID = "43746fd0-bce2-472b-93e4-a438177b2dff"

# Em-dash literal used in the EE26 bulk invite name prefix (U+2014, NOT a hyphen).
_EE26_INVITE_PREFIX = "EE26 invite — %"

revision: str = "bfaabd563367"
down_revision: str | Sequence[str] | None = "d4b1e7a9c2f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill_legacy(connection) -> None:  # noqa: ANN001
    """Migrate EE26 legacy groups into the new invites/referrals model.

    Called at the end of upgrade(). Safe to call multiple times — all inserts
    use ON CONFLICT DO NOTHING (idempotent via the partial unique index
    uq_invites_legacy_group_id on invites, and uq_referrals_popup_code on referrals).

    Design: Migration Plan → _backfill_legacy helper (PR-7, T-gr-045, revised June 2026).
    Spec: REQ-GR-023 (bucket classification), REQ-GR-024 (idempotency).

    Five-rule taxonomy applied in PRIORITY ORDER (mutually exclusive):

    Rule 1 — REFERRAL: is_ambassador_group = true (~1 row)
      INSERT INTO referrals using ambassador_id as referrer_human_id.
      Idempotent: ON CONFLICT (popup_id, code) DO NOTHING.

    Rule 2 — INVITE bulk: is_ambassador_group = false
                          AND name LIKE 'EE26 invite — %' (em-dash U+2014)
                          AND max_members = 10  (~16,899 rows)
      INSERT INTO invites with max_uses=10, token=group.slug, auto_approve=true,
      express_checkout=true. Batched 500/iter for performance.
      If the group has an existing application, set used_at + redeemed_by_human_id
      + current_uses=1 and backfill applications.invite_id.

    Rule 3 — INVITE named: is_ambassador_group = false
                           AND name NOT LIKE 'EE26 invite — %'
                           AND (name ILIKE '%invite%' OR name ILIKE '%link%')  (~6 rows)
      INSERT INTO invites with max_uses=NULL (multi-use), current_uses=COUNT(applications).
      Backfills all applications.invite_id for the group.

    Rule 4 — GROUP residency: ... AND name ILIKE '%residency%'  (~7 rows)
      STAY as groups — no conversion, no flag mutation.

    Rule 5 — GROUP leftover: everything else (~1 row, "Supernuclear").
      STAY as groups — no action.

    Total expected: 1 referral + 16,905 invites + 8 groups = 16,914.

    Each rule's data-write block runs in its own SAVEPOINT for partial-failure recovery.
    The admin-user lookup (needed for invites.created_by) is done once before Rule 2.
    If no admin user is found, Rules 2 and 3 are skipped gracefully (non-EE26 environment).
    """
    BATCH_SIZE = 500

    # --- Rule 1: ambassador groups → referrals ---
    connection.execute(text("SAVEPOINT sp_rule1_referral"))
    try:
        referral_rows_r = connection.execute(
            text("""
                SELECT
                    g.id            AS group_id,
                    g.tenant_id,
                    g.popup_id,
                    g.slug          AS code,
                    g.discount_percentage,
                    g.ambassador_id AS referrer_human_id
                FROM groups g
                WHERE g.popup_id = :popup_id
                  AND g.is_ambassador_group = true
            """),
            {"popup_id": _EE26_POPUP_ID},
        ).fetchall()

        for row in referral_rows_r:
            if row.referrer_human_id is None:
                # Ambassador group without a linked human — cannot create referral row.
                # Skip and leave as group (no-op for migration purposes).
                continue
            connection.execute(
                text("""
                    INSERT INTO referrals (
                        id, tenant_id, popup_id, referrer_human_id, code,
                        discount_percentage, auto_approve, max_uses, current_uses
                    ) VALUES (
                        :id, :tenant_id, :popup_id, :referrer_human_id, :code,
                        :discount_percentage, false, NULL, 0
                    )
                    ON CONFLICT (popup_id, code) DO NOTHING
                """),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": str(row.tenant_id),
                    "popup_id": str(row.popup_id),
                    "referrer_human_id": str(row.referrer_human_id),
                    "code": row.code,
                    "discount_percentage": row.discount_percentage,
                },
            )

        connection.execute(text("RELEASE SAVEPOINT sp_rule1_referral"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_rule1_referral"))
        raise

    # Look up an admin user for created_by (needed by Rules 2 + 3).
    # This is outside any SAVEPOINT so we read it once and reuse.
    sys_created_by = connection.execute(
        text("""
            SELECT u.id FROM users u
            JOIN tenants t ON t.id = u.tenant_id
            JOIN popups p ON p.tenant_id = t.id
            WHERE p.id = :popup_id
              AND lower(u.role) IN ('admin', 'superadmin')
            LIMIT 1
        """),
        {"popup_id": _EE26_POPUP_ID},
    ).scalar()

    # --- Rule 2: bulk invite groups → single-token multi-use invites (batched) ---
    connection.execute(text("SAVEPOINT sp_rule2_bulk_invites"))
    try:
        bulk_rows = connection.execute(
            text("""
                SELECT
                    g.id            AS group_id,
                    g.tenant_id,
                    g.popup_id,
                    g.slug          AS token,
                    g.discount_percentage,
                    a.id            AS app_id,
                    a.human_id      AS app_human_id,
                    a.created_at    AS app_created_at
                FROM groups g
                LEFT JOIN LATERAL (
                    SELECT id, human_id, created_at
                    FROM applications
                    WHERE group_id = g.id
                    LIMIT 1
                ) a ON true
                WHERE g.popup_id = :popup_id
                  AND g.is_ambassador_group = false
                  AND g.name LIKE :prefix
                  AND g.max_members = 10
            """),
            {"popup_id": _EE26_POPUP_ID, "prefix": _EE26_INVITE_PREFIX},
        ).fetchall()

        if bulk_rows and sys_created_by is not None:
            for offset in range(0, len(bulk_rows), BATCH_SIZE):
                batch = bulk_rows[offset : offset + BATCH_SIZE]
                invite_rows = []
                app_backfill_pairs = []

                for row in batch:
                    new_invite_id = str(uuid.uuid4())
                    invite_rows.append(
                        {
                            "id": new_invite_id,
                            "tenant_id": str(row.tenant_id),
                            "popup_id": str(row.popup_id),
                            "token": row.token,
                            "discount_percentage": row.discount_percentage,
                            "auto_approve": True,
                            "express_checkout": True,
                            "max_uses": 10,
                            "current_uses": 1 if row.app_id else 0,
                            "used_at": row.app_created_at if row.app_id else None,
                            "redeemed_by_human_id": (
                                str(row.app_human_id) if row.app_human_id else None
                            ),
                            "legacy_migrated_from_group_id": str(row.group_id),
                            "created_by": str(sys_created_by),
                        }
                    )
                    if row.app_id:
                        app_backfill_pairs.append(
                            {"app_id": str(row.app_id), "invite_id": new_invite_id}
                        )

                if invite_rows:
                    connection.execute(
                        text("""
                            INSERT INTO invites (
                                id, tenant_id, popup_id, token, discount_percentage,
                                auto_approve, express_checkout, max_uses, current_uses,
                                used_at, redeemed_by_human_id,
                                legacy_migrated_from_group_id, created_by
                            ) VALUES (
                                :id, :tenant_id, :popup_id, :token, :discount_percentage,
                                :auto_approve, :express_checkout, :max_uses, :current_uses,
                                :used_at, :redeemed_by_human_id,
                                :legacy_migrated_from_group_id, :created_by
                            )
                            ON CONFLICT (legacy_migrated_from_group_id)
                            WHERE legacy_migrated_from_group_id IS NOT NULL
                            DO NOTHING
                        """),
                        invite_rows,
                    )

                # Backfill applications.invite_id for this batch
                for pair in app_backfill_pairs:
                    connection.execute(
                        text("""
                            UPDATE applications
                            SET invite_id = (
                                SELECT id FROM invites
                                WHERE legacy_migrated_from_group_id =
                                    (SELECT group_id FROM applications
                                     WHERE id = :app_id LIMIT 1)
                                LIMIT 1
                            )
                            WHERE id = :app_id
                              AND invite_id IS NULL
                        """),
                        {"app_id": pair["app_id"]},
                    )

        connection.execute(text("RELEASE SAVEPOINT sp_rule2_bulk_invites"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_rule2_bulk_invites"))
        raise

    # --- Rule 3: named invite groups → multi-use invites ---
    connection.execute(text("SAVEPOINT sp_rule3_named_invites"))
    try:
        named_rows = connection.execute(
            text("""
                SELECT
                    g.id            AS group_id,
                    g.tenant_id,
                    g.popup_id,
                    g.slug          AS token,
                    g.discount_percentage,
                    (SELECT COUNT(*) FROM applications
                     WHERE group_id = g.id) AS app_count
                FROM groups g
                WHERE g.popup_id = :popup_id
                  AND g.is_ambassador_group = false
                  AND g.name NOT LIKE :prefix
                  AND (g.name ILIKE '%invite%' OR g.name ILIKE '%link%')
            """),
            {"popup_id": _EE26_POPUP_ID, "prefix": _EE26_INVITE_PREFIX},
        ).fetchall()

        if named_rows and sys_created_by is not None:
            invite_rows_named = []
            for row in named_rows:
                invite_rows_named.append(
                    {
                        "id": str(uuid.uuid4()),
                        "tenant_id": str(row.tenant_id),
                        "popup_id": str(row.popup_id),
                        "token": row.token,
                        "discount_percentage": row.discount_percentage,
                        "auto_approve": True,
                        "express_checkout": True,
                        "max_uses": None,
                        "current_uses": int(row.app_count),
                        "used_at": None,
                        "redeemed_by_human_id": None,
                        "legacy_migrated_from_group_id": str(row.group_id),
                        "created_by": str(sys_created_by),
                    }
                )

            connection.execute(
                text("""
                    INSERT INTO invites (
                        id, tenant_id, popup_id, token, discount_percentage,
                        auto_approve, express_checkout, max_uses, current_uses,
                        used_at, redeemed_by_human_id,
                        legacy_migrated_from_group_id, created_by
                    ) VALUES (
                        :id, :tenant_id, :popup_id, :token, :discount_percentage,
                        :auto_approve, :express_checkout, :max_uses, :current_uses,
                        :used_at, :redeemed_by_human_id,
                        :legacy_migrated_from_group_id, :created_by
                    )
                    ON CONFLICT (legacy_migrated_from_group_id)
                    WHERE legacy_migrated_from_group_id IS NOT NULL
                    DO NOTHING
                """),
                invite_rows_named,
            )

            # Backfill applications.invite_id for all apps in each named-invite group
            for row in named_rows:
                connection.execute(
                    text("""
                        UPDATE applications
                        SET invite_id = (
                            SELECT id FROM invites
                            WHERE legacy_migrated_from_group_id = :group_id
                            LIMIT 1
                        )
                        WHERE group_id = :group_id
                          AND invite_id IS NULL
                    """),
                    {"group_id": str(row.group_id)},
                )

        connection.execute(text("RELEASE SAVEPOINT sp_rule3_named_invites"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_rule3_named_invites"))
        raise

    # Rules 4 and 5 (residency groups and leftover groups) are intentionally
    # no-ops — they stay as groups with no conversion and no flag mutation.


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. groups — new behaviour flags
    # ------------------------------------------------------------------
    op.add_column(
        "groups",
        sa.Column(
            "auto_approve_applications",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "express_checkout",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "enable_private_events",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ------------------------------------------------------------------
    # 2. popups — per-popup feature flags for the new capabilities
    # ------------------------------------------------------------------
    op.add_column(
        "popups",
        sa.Column(
            "invites_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "referrals_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "group_private_events_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    # ------------------------------------------------------------------
    # 3. invites table — token-based admin offer
    # ------------------------------------------------------------------
    op.create_table(
        "invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("recipient_email", sa.String(), nullable=True),
        sa.Column(
            "discount_percentage",
            sa.Numeric(5, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "auto_approve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "express_checkout",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column(
            "current_uses", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("redeemed_by_human_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "legacy_migrated_from_group_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["redeemed_by_human_id"], ["humans.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["legacy_migrated_from_group_id"], ["groups.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
    )
    # Unique index on (popup_id, token) — the natural lookup key
    op.create_index(
        "uq_invites_popup_token", "invites", ["popup_id", "token"], unique=True
    )
    # Partial unique index for idempotency guard on legacy data migration (PR-7)
    op.create_index(
        "uq_invites_legacy_group_id",
        "invites",
        ["legacy_migrated_from_group_id"],
        unique=True,
        postgresql_where=sa.text("legacy_migrated_from_group_id IS NOT NULL"),
    )
    # Supporting indexes
    op.create_index("ix_invites_tenant_id", "invites", ["tenant_id"])
    op.create_index(
        "ix_invites_popup_recipient_email", "invites", ["popup_id", "recipient_email"]
    )

    # Apply RLS for tenant isolation
    add_tenant_table_permissions("invites")

    # ------------------------------------------------------------------
    # 4. referrals table — human-driven ambassador code
    # ------------------------------------------------------------------
    op.create_table(
        "referrals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("referrer_human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column(
            "discount_percentage",
            sa.Numeric(5, 2),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "auto_approve",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column(
            "current_uses", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["referrer_human_id"], ["humans.id"], ondelete="RESTRICT"
        ),
    )
    # Unique index on (popup_id, code) — the natural lookup key
    op.create_index(
        "uq_referrals_popup_code", "referrals", ["popup_id", "code"], unique=True
    )
    # Supporting index
    op.create_index(
        "ix_referrals_referrer_human_id", "referrals", ["referrer_human_id"]
    )
    op.create_index("ix_referrals_tenant_id", "referrals", ["tenant_id"])

    # Apply RLS for tenant isolation
    add_tenant_table_permissions("referrals")

    # ------------------------------------------------------------------
    # 5. events — group_id FK (group-scoped private events)
    #    ON DELETE RESTRICT: prevents a group from being deleted while it
    #    still owns private events. Admin must clean up events first.
    # ------------------------------------------------------------------
    op.add_column(
        "events",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_events_group_id",
        "events",
        "groups",
        ["group_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # Partial index: only relevant for events that actually belong to a group
    op.create_index(
        "ix_events_group_start",
        "events",
        ["group_id", "start_time"],
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # 6. applications — invite_id and referral_id attribution columns
    #    Must come AFTER invites and referrals tables are created above.
    # ------------------------------------------------------------------
    op.add_column(
        "applications",
        sa.Column("invite_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_invite_id",
        "applications",
        "invites",
        ["invite_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_applications_invite_id",
        "applications",
        ["invite_id"],
        postgresql_where=sa.text("invite_id IS NOT NULL"),
    )

    op.add_column(
        "applications",
        sa.Column("referral_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_referral_id",
        "applications",
        "referrals",
        ["referral_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_applications_referral_id",
        "applications",
        ["referral_id"],
        postgresql_where=sa.text("referral_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # 7. Legacy data migration — EE26 backfill (T-gr-045)
    #    Called AFTER all schema objects exist.
    #    Idempotent: ON CONFLICT DO NOTHING guards prevent duplicate inserts.
    # ------------------------------------------------------------------
    bind = op.get_bind()
    _backfill_legacy(bind)


def downgrade() -> None:
    """Reverse the groups-rework migration.

    Data reversal (T-gr-046, revised June 2026):
      1. Check for non-legacy invites — raise if any exist (unsafe to downgrade).
      2. Null applications.invite_id for all migrated invites (FK cleanup).
      3. Delete invites created by this migration (legacy_migrated_from_group_id IS NOT NULL).
      4. Delete referrals created by this migration (ambassador groups' slugs as codes
         for the EE26 popup).
      5. Drop all new schema objects in reverse order.

    NOTE: Rules 4 and 5 groups (residencies, leftover) were NEVER modified by upgrade(),
    so there is nothing to reverse for them.

    WARNING: downgrade is only safe if no post-migration data was created
    (admin invites, referrals, group-scoped events). Clean up manually first.
    """
    bind = op.get_bind()

    # ------------------------------------------------------------------
    # D-0. Data reversal: legacy invites + referrals cleanup (Spec: REQ-GR-025)
    # ------------------------------------------------------------------

    # Check for non-legacy invites — downgrade is blocked if any exist
    non_legacy_count = bind.execute(
        text("SELECT COUNT(*) FROM invites WHERE legacy_migrated_from_group_id IS NULL")
    ).scalar()
    if non_legacy_count and non_legacy_count > 0:
        raise RuntimeError(
            f"Cannot downgrade: {non_legacy_count} non-legacy invite(s) exist. "
            "Delete all admin-created invites manually before running downgrade."
        )

    # Null applications.invite_id for migrated invites first (FK dep)
    bind.execute(
        text("""
            UPDATE applications
            SET invite_id = NULL
            WHERE invite_id IN (
                SELECT id FROM invites
                WHERE legacy_migrated_from_group_id IS NOT NULL
            )
        """)
    )

    # Delete all legacy-migrated invites (Rules 2 and 3)
    bind.execute(
        text("DELETE FROM invites WHERE legacy_migrated_from_group_id IS NOT NULL")
    )

    # Delete referrals created from ambassador groups (Rule 1).
    # Identified by: popup_id = EE26 AND code IN (slugs of ambassador groups).
    # This is deterministic because code = group.slug was set at migration time.
    bind.execute(
        text("""
            DELETE FROM referrals
            WHERE popup_id = :popup_id
              AND code IN (
                  SELECT slug FROM groups
                  WHERE popup_id = :popup_id
                    AND is_ambassador_group = true
              )
        """),
        {"popup_id": _EE26_POPUP_ID},
    )

    # ------------------------------------------------------------------
    # D-1. applications — drop attribution columns first (FK dependencies)
    # ------------------------------------------------------------------
    op.drop_index("ix_applications_referral_id", table_name="applications")
    op.drop_constraint(
        "fk_applications_referral_id", "applications", type_="foreignkey"
    )
    op.drop_column("applications", "referral_id")

    op.drop_index("ix_applications_invite_id", table_name="applications")
    op.drop_constraint("fk_applications_invite_id", "applications", type_="foreignkey")
    op.drop_column("applications", "invite_id")

    # ------------------------------------------------------------------
    # 2. events — defensive null then drop group_id
    # ------------------------------------------------------------------
    op.execute("UPDATE events SET group_id = NULL WHERE group_id IS NOT NULL")
    op.drop_index("ix_events_group_start", table_name="events")
    op.drop_constraint("fk_events_group_id", "events", type_="foreignkey")
    op.drop_column("events", "group_id")

    # ------------------------------------------------------------------
    # 3. referrals — remove RLS then drop table
    # ------------------------------------------------------------------
    remove_tenant_table_permissions("referrals")
    op.drop_index("ix_referrals_tenant_id", table_name="referrals")
    op.drop_index("ix_referrals_referrer_human_id", table_name="referrals")
    op.drop_index("uq_referrals_popup_code", table_name="referrals")
    op.drop_table("referrals")

    # ------------------------------------------------------------------
    # 4. invites — remove RLS then drop table
    # ------------------------------------------------------------------
    remove_tenant_table_permissions("invites")
    op.drop_index("ix_invites_popup_recipient_email", table_name="invites")
    op.drop_index("ix_invites_tenant_id", table_name="invites")
    op.drop_index("uq_invites_legacy_group_id", table_name="invites")
    op.drop_index("uq_invites_popup_token", table_name="invites")
    op.drop_table("invites")

    # ------------------------------------------------------------------
    # 5. popups — drop feature flags
    # ------------------------------------------------------------------
    op.drop_column("popups", "group_private_events_enabled")
    op.drop_column("popups", "referrals_enabled")
    op.drop_column("popups", "invites_enabled")

    # ------------------------------------------------------------------
    # 6. groups — drop behaviour flags
    # ------------------------------------------------------------------
    op.drop_column("groups", "enable_private_events")
    op.drop_column("groups", "express_checkout")
    op.drop_column("groups", "auto_approve_applications")
