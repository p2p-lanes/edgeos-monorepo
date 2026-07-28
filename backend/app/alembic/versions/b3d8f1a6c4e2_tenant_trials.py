"""Self-serve trial provisioning: tenant trial columns + pending_trials.

Adds to ``tenants`` (global table, NOT RLS-scoped):
  - is_trial: marks tenants created through the self-serve trial flow.
  - trial_expires_at: end of the 7-day trial window.
  - suspended_at: reversible suspension (distinct from the ``deleted``
    soft-delete, which revokes the tenant's Postgres credentials).
    Reactivation = clearing the field; data and credentials stay intact.
  - trial_reminder_sent_at: idempotency flag for the "2 days left" email.

Creates ``pending_trials`` — DB fallback storage for trial signups awaiting
OTP verification (Redis is the primary store, mirroring pending_humans).
Like ``tasks``, this table is GLOBAL and reached exclusively through the
privileged main engine: no tenant RLS policy, no grants to the tenant DB
roles (deny-by-default).

Revision ID: b3d8f1a6c4e2
Revises: a8e3d7f4c2b9
Create Date: 2026-07-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b3d8f1a6c4e2"
down_revision: str | Sequence[str] | None = "d4f7b2a9c1e6"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column(
            "is_trial",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "tenants",
        sa.Column("trial_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tenants",
        sa.Column("trial_reminder_sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "pending_trials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("gathering_name", sa.String(length=255), nullable=False),
        sa.Column("auth_code", sa.String(length=6), nullable=False),
        sa.Column("code_expiration", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_pending_trial_email"),
    )
    # No grants to tenant_role / tenant_viewer_role: global table, main engine only.


def downgrade() -> None:
    op.drop_table("pending_trials")
    op.drop_column("tenants", "trial_reminder_sent_at")
    op.drop_column("tenants", "suspended_at")
    op.drop_column("tenants", "trial_expires_at")
    op.drop_column("tenants", "is_trial")
