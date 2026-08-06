"""Merge referrals into invites

Referrals and Invites modelled the same thing: a shareable link carrying an
access policy (discount, auto-approve, use limits, expiry). The only real
difference was the issuer -- an admin (invites.created_by) or an attendee
(referrals.referrer_human_id) -- plus the invite's optional email binding.

Referral rows are copied into invites PRESERVING THEIR ID, so every existing
applications.referral_id keeps resolving and every shared /r/{code} URL keeps
working. The referrals table is left in place, now unread, and is dropped once
the API and both frontends stop referring to it.

Revision ID: a3f8c1d94e27
Revises: 789b23407b33
Create Date: 2026-08-06

"""

from alembic import op

revision = "a3f8c1d94e27"
down_revision = "789b23407b33"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Invites gain the issuer and kill-switch columns referrals had.
    op.execute("ALTER TABLE invites ALTER COLUMN created_by DROP NOT NULL")
    op.execute(
        "ALTER TABLE invites ADD COLUMN IF NOT EXISTS referrer_human_id UUID "
        "REFERENCES humans(id)"
    )
    op.execute(
        "ALTER TABLE invites ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN "
        "NOT NULL DEFAULT false"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_invites_referrer_human_id "
        "ON invites (referrer_human_id)"
    )

    # 2. Both codes and tokens can be caller-supplied, so a referral code may
    #    collide with an invite token inside the same popup. uq_invites_popup_token
    #    would reject that row, and step 3's foreign key would then fail on the
    #    applications still pointing at it. Stop here instead, naming the rows:
    #    resolving the clash means renaming a link somebody may have shared.
    collisions = (
        op.get_bind()
        .exec_driver_sql(
            """
            SELECT r.id, r.popup_id, r.code
            FROM referrals r
            JOIN invites i
              ON i.popup_id = r.popup_id AND i.token = r.code AND i.id <> r.id
            """
        )
        .fetchall()
    )
    if collisions:
        listed = ", ".join(f"{row[2]!r} (popup {row[1]})" for row in collisions)
        raise RuntimeError(
            "Cannot merge referrals into invites: these referral codes already "
            f"exist as invite tokens in the same popup: {listed}. Rename one side "
            "before upgrading."
        )

    # 3. Copy referrals across, keeping ids. express_checkout is true because
    #    the portal always rendered the reduced form for referral links.
    #    ON CONFLICT makes a re-run a no-op.
    op.execute(
        """
        INSERT INTO invites (
            id, tenant_id, popup_id, token, recipient_email,
            discount_percentage, auto_approve, express_checkout, is_disabled,
            max_uses, current_uses, expires_at, referrer_human_id, created_by,
            created_at, updated_at
        )
        SELECT
            r.id, r.tenant_id, r.popup_id, r.code, NULL,
            r.discount_percentage, r.auto_approve, true, r.is_disabled,
            r.max_uses, r.current_uses, r.expires_at, r.referrer_human_id, NULL,
            r.created_at, r.updated_at
        FROM referrals r
        ON CONFLICT (id) DO NOTHING
        """
    )

    # 4. applications.referral_id now names an invite. Ids were preserved, so
    #    every stored value stays valid across the swap. The constraint keeps
    #    its name from bfaabd563367 (fk_applications_referral_id, NOT the
    #    postgres default) -- dropping the wrong name leaves the old
    #    referrals-bound constraint in place and every attribution insert fails.
    op.execute(
        "ALTER TABLE applications DROP CONSTRAINT IF EXISTS "
        "fk_applications_referral_id"
    )
    op.execute(
        "ALTER TABLE applications ADD CONSTRAINT fk_applications_referral_id "
        "FOREIGN KEY (referral_id) REFERENCES invites(id)"
    )


def downgrade() -> None:
    # Point attribution back at the referrals table, which was never dropped.
    # Any application attributed to a link created after the upgrade has no
    # matching referrals row, so clear those before restoring the constraint.
    op.execute(
        "ALTER TABLE applications DROP CONSTRAINT IF EXISTS "
        "fk_applications_referral_id"
    )
    op.execute(
        "UPDATE applications SET referral_id = NULL WHERE referral_id IS NOT NULL "
        "AND referral_id NOT IN (SELECT id FROM referrals)"
    )
    op.execute(
        "ALTER TABLE applications ADD CONSTRAINT fk_applications_referral_id "
        "FOREIGN KEY (referral_id) REFERENCES referrals(id)"
    )

    # Drop only the copied rows; admin invites must survive.
    op.execute("DELETE FROM invites WHERE referrer_human_id IS NOT NULL")

    op.execute("DROP INDEX IF EXISTS ix_invites_referrer_human_id")
    op.execute("ALTER TABLE invites DROP COLUMN IF EXISTS is_disabled")
    op.execute("ALTER TABLE invites DROP COLUMN IF EXISTS referrer_human_id")
    op.execute("ALTER TABLE invites ALTER COLUMN created_by SET NOT NULL")
