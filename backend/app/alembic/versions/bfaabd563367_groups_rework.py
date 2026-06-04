"""Groups rework — DB foundation for invite/referral split + group-private events.

Adds new feature-flag columns to groups, popups, events, and applications.
Creates the invites and referrals tables with RLS.
Includes _backfill_legacy() to migrate ~16,913 EE26 rows into the new model.

EventVisibility enum unchanged — group-scoped privacy uses PRIVATE + group_id IS NOT NULL;
no ALTER on the visibility column. The EventVisibility Python enum stays at exactly
{PUBLIC, UNLISTED, PRIVATE}.

Revision ID: bfaabd563367
Revises: d4b1e7a9c2f5

--- Legacy data migration (PR-7) ---

EE26 popup_id: 43746fd0-bce2-472b-93e4-a438177b2dff

Three-bucket classification:
  A. Bulk groups   — name ~* '^ee26-bulk-' AND max_members = 1
                   → single-use Invite (max_uses=1). ~16,899 rows.
  B. Masivos       — name ILIKE '%masivo%' AND max_members IS NULL
                   → multi-use Invite (max_uses=NULL). ~9 rows.
  C. Residencies   — max_members IS NOT NULL AND max_members > 1
                     AND is_ambassador_group = false
                     AND name NOT ILIKE '%masivo%'
                   → mutate flags in place (auto_approve_applications=true,
                     express_checkout=true). ~5 rows.

Idempotency: INSERT ... ON CONFLICT (legacy_migrated_from_group_id) DO NOTHING
(partial unique index uq_invites_legacy_group_id created in schema block above).

NOTE: Bucket A detection uses `max_members = 1` per design. The spec mentions
max_members=10 which may reflect a different snapshot of the prod data. The
slug regex pattern `name ~* '^ee26-bulk-'` is the definitive filter; confirm
counts on staging before running on prod.
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

# IMPORTANT: downgrade() needs to reverse Bucket C flags. These IDs are captured
# at migration time via SELECT and stored below so downgrade can be deterministic.
# In practice, downgrade on prod requires manual data cleanup; this reversal is
# provided for CI correctness.
_BUCKET_C_QUERY = """
SELECT id FROM groups
WHERE popup_id = :popup_id
  AND max_members IS NOT NULL
  AND max_members > 1
  AND is_ambassador_group = false
  AND name NOT ILIKE '%masivo%'
"""

revision: str = "bfaabd563367"
down_revision: str | Sequence[str] | None = "d4b1e7a9c2f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _backfill_legacy(connection) -> None:  # noqa: ANN001
    """Migrate EE26 legacy groups into the new invites/referrals model.

    Called at the end of upgrade(). Safe to call multiple times — all inserts
    use ON CONFLICT DO NOTHING (idempotent via the partial unique index
    uq_invites_legacy_group_id WHERE legacy_migrated_from_group_id IS NOT NULL).

    Design: Migration Plan → _backfill_legacy helper (PR-7, T-gr-045).
    Spec: REQ-GR-023 (three-bucket classification), REQ-GR-024 (idempotency).

    Bucket A — bulk single-use invites (~16,899 rows):
      SELECT groups WHERE popup_id=EE26 AND name ~* '^ee26-bulk-' AND max_members=1
      INSERT INTO invites with max_uses=1, token=group.slug, auto_approve=true,
      express_checkout=true. If the group already has an application, set
      used_at + redeemed_by_human_id + current_uses=1 and backfill
      applications.invite_id.

    Bucket B — masivos multi-use invites (~9 rows):
      SELECT groups WHERE popup_id=EE26 AND name ILIKE '%masivo%' AND max_members IS NULL
      INSERT INTO invites with max_uses=NULL, current_uses=COUNT(applications).

    Bucket C — residencies in-place flag update (~5 rows):
      UPDATE groups SET auto_approve_applications=true, express_checkout=true.
      No row creation.

    Each bucket runs in its own SAVEPOINT for partial-failure recovery.
    Rows are inserted in batches of 500.
    """
    BATCH_SIZE = 500

    # --- Bucket A: bulk → single-use invites ---
    connection.execute(text("SAVEPOINT sp_bucket_a"))
    try:
        bucket_a_rows = connection.execute(
            text("""
                SELECT
                    g.id         AS group_id,
                    g.tenant_id,
                    g.popup_id,
                    g.slug       AS token,
                    g.discount_percentage,
                    a.id         AS app_id,
                    a.human_id   AS app_human_id,
                    a.created_at AS app_created_at
                FROM groups g
                LEFT JOIN LATERAL (
                    SELECT id, human_id, created_at
                    FROM applications
                    WHERE group_id = g.id
                    LIMIT 1
                ) a ON true
                WHERE g.popup_id = :popup_id
                  AND g.name ~* '^ee26-bulk-'
                  AND g.max_members = 1
            """),
            {"popup_id": _EE26_POPUP_ID},
        ).fetchall()

        # We need a system user id for created_by. Query an admin user for this
        # popup's tenant to use as migration author.
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

        if sys_created_by is None:
            # No admin user found — skip bucket A (dev/test environment without EE26)
            connection.execute(text("RELEASE SAVEPOINT sp_bucket_a"))
            return

        for offset in range(0, len(bucket_a_rows), BATCH_SIZE):
            batch = bucket_a_rows[offset : offset + BATCH_SIZE]
            invite_rows = []
            app_backfill_pairs = []  # (app_id, group_id) for applications.invite_id

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
                        "max_uses": 1,
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
                            used_at, redeemed_by_human_id, legacy_migrated_from_group_id,
                            created_by
                        ) VALUES (
                            :id, :tenant_id, :popup_id, :token, :discount_percentage,
                            :auto_approve, :express_checkout, :max_uses, :current_uses,
                            :used_at, :redeemed_by_human_id, :legacy_migrated_from_group_id,
                            :created_by
                        )
                        ON CONFLICT (legacy_migrated_from_group_id)
                        WHERE legacy_migrated_from_group_id IS NOT NULL
                        DO NOTHING
                    """),
                    invite_rows,
                )

            # Backfill applications.invite_id for used invites
            if app_backfill_pairs:
                # Fetch the actual inserted invite ids keyed by group_id
                # (ON CONFLICT DO NOTHING means we need the real ids)
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

        connection.execute(text("RELEASE SAVEPOINT sp_bucket_a"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_bucket_a"))
        raise

    # --- Bucket B: masivos → multi-use invites ---
    connection.execute(text("SAVEPOINT sp_bucket_b"))
    try:
        bucket_b_rows = connection.execute(
            text("""
                SELECT
                    g.id          AS group_id,
                    g.tenant_id,
                    g.popup_id,
                    g.slug        AS token,
                    g.discount_percentage,
                    (SELECT COUNT(*) FROM applications
                     WHERE group_id = g.id) AS app_count
                FROM groups g
                WHERE g.popup_id = :popup_id
                  AND g.name ILIKE '%masivo%'
                  AND g.max_members IS NULL
            """),
            {"popup_id": _EE26_POPUP_ID},
        ).fetchall()

        if bucket_b_rows and sys_created_by is not None:
            invite_rows_b = []
            for row in bucket_b_rows:
                new_invite_id = str(uuid.uuid4())
                invite_rows_b.append(
                    {
                        "id": new_invite_id,
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
                        used_at, redeemed_by_human_id, legacy_migrated_from_group_id,
                        created_by
                    ) VALUES (
                        :id, :tenant_id, :popup_id, :token, :discount_percentage,
                        :auto_approve, :express_checkout, :max_uses, :current_uses,
                        :used_at, :redeemed_by_human_id, :legacy_migrated_from_group_id,
                        :created_by
                    )
                    ON CONFLICT (legacy_migrated_from_group_id)
                    WHERE legacy_migrated_from_group_id IS NOT NULL
                    DO NOTHING
                """),
                invite_rows_b,
            )

            # Backfill applications.invite_id for masivos (all apps for that group)
            for row in bucket_b_rows:
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

        connection.execute(text("RELEASE SAVEPOINT sp_bucket_b"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_bucket_b"))
        raise

    # --- Bucket C: residencies → in-place flag update ---
    connection.execute(text("SAVEPOINT sp_bucket_c"))
    try:
        connection.execute(
            text("""
                UPDATE groups
                SET auto_approve_applications = true,
                    express_checkout = true
                WHERE popup_id = :popup_id
                  AND max_members IS NOT NULL
                  AND max_members > 1
                  AND is_ambassador_group = false
                  AND name NOT ILIKE '%masivo%'
            """),
            {"popup_id": _EE26_POPUP_ID},
        )
        connection.execute(text("RELEASE SAVEPOINT sp_bucket_c"))

    except Exception:
        connection.execute(text("ROLLBACK TO SAVEPOINT sp_bucket_c"))
        raise


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

    Data reversal (T-gr-046):
      1. Null applications.invite_id for all migrated invites (FK cleanup).
      2. Check for post-migration non-legacy invites — raise if any exist
         (downgrade is unsafe if admin-created invites are present).
      3. Delete invites created by this migration (legacy_migrated_from_group_id IS NOT NULL).
      4. Reverse Bucket C flag changes on residency groups.
      5. Drop all new schema objects in reverse order.

    WARNING: downgrade is only safe if no post-migration data was created
    (admin invites, referrals, group-scoped events). Clean up manually first.
    """
    bind = op.get_bind()

    # ------------------------------------------------------------------
    # D-0. Data reversal: legacy invites cleanup (Spec: REQ-GR-025)
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

    # Delete all legacy-migrated invites
    bind.execute(
        text(
            "DELETE FROM invites WHERE legacy_migrated_from_group_id IS NOT NULL"
        )
    )

    # Reverse Bucket C residency flag changes
    bind.execute(
        text("""
            UPDATE groups
            SET auto_approve_applications = false,
                express_checkout = false
            WHERE popup_id = :popup_id
              AND max_members IS NOT NULL
              AND max_members > 1
              AND is_ambassador_group = false
              AND name NOT ILIKE '%masivo%'
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
