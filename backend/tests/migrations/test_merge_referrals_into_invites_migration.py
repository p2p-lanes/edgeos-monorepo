"""Schema shape left by a3f8c1d94e27 (merge referrals into invites).

The data copy itself cannot be asserted here: the suite runs migrations once,
against an empty database, so there are no referral rows to carry over. What
this pins is the shape every later code path depends on -- the issuer columns,
and above all applications.referral_id pointing at invites rather than at
referrals. That last one silently broke attribution when the constraint was
dropped under the wrong name.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session


class TestMergeReferralsIntoInvitesMigration:
    def test_invites_has_referrer_human_id(self, db: Session) -> None:
        row = db.exec(
            text(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_name = 'invites' AND column_name = 'referrer_human_id'
                """
            )
        ).first()
        assert row is not None, "Column 'referrer_human_id' not found on invites."
        assert row[0] == "YES", "referrer_human_id must be nullable (admin invites)"

    def test_invites_has_is_disabled_defaulting_to_false(self, db: Session) -> None:
        row = db.exec(
            text(
                """
                SELECT is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = 'invites' AND column_name = 'is_disabled'
                """
            )
        ).first()
        assert row is not None, "Column 'is_disabled' not found on invites."
        assert row[0] == "NO", "is_disabled must be NOT NULL"
        assert "false" in (row[1] or ""), (
            f"is_disabled must default false, got {row[1]}"
        )

    def test_invites_created_by_is_nullable(self, db: Session) -> None:
        """Portal-created links have no admin behind them."""
        row = db.exec(
            text(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_name = 'invites' AND column_name = 'created_by'
                """
            )
        ).first()
        assert row is not None
        assert row[0] == "YES", "created_by must be nullable after the merge"

    def test_applications_referral_id_points_at_invites(self, db: Session) -> None:
        """The constraint must be repointed, and exactly one must remain.

        bfaabd563367 named it fk_applications_referral_id, not the postgres
        default. Dropping the default name instead leaves the referrals-bound
        constraint in place, and every attributed application then fails to
        insert with a bare integrity error.
        """
        rows = db.exec(
            text(
                """
                SELECT tc.constraint_name, ccu.table_name AS target_table
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.table_name = 'applications'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND kcu.column_name = 'referral_id'
                """
            )
        ).all()

        assert len(rows) == 1, f"expected exactly one FK on referral_id, got {rows}"
        assert rows[0][1] == "invites", (
            f"referral_id must reference invites, references {rows[0][1]}"
        )

    def test_referrals_table_is_gone(self, db: Session) -> None:
        """b8e2d7f45a19 drops it once nothing speaks referral anymore.

        It outlived the copy on purpose, so the merge stayed reversible while
        the API and both frontends were migrated.
        """
        row = db.exec(text("SELECT to_regclass('public.referrals')")).first()
        assert row is not None and row[0] is None, "referrals should have been dropped"

    def test_both_attribution_columns_still_point_at_invites(self, db: Session) -> None:
        """invite_id and referral_id are kept as a pair, not collapsed.

        Together they record HOW someone entered -- through a backoffice link or
        an attendee one -- without a join.
        """
        rows = db.exec(
            text(
                """
                SELECT kcu.column_name, ccu.table_name AS target_table
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.table_name = 'applications'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND kcu.column_name IN ('invite_id', 'referral_id')
                """
            )
        ).all()

        targets = {row[0]: row[1] for row in rows}
        assert targets == {"invite_id": "invites", "referral_id": "invites"}, targets
