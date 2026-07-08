"""Backfill open_checkout_signing_secret for existing popups that have NULL.

The column was added in migration c8d2a6f4e1b9 but no default was set for
existing rows. Any popup created before the auto-provisioning CRUD hook
(PopupsCRUD.create, TASK-03) landed will have open_checkout_signing_secret=NULL,
which means cart restore tokens cannot be signed and return-time release proofs
cannot be validated.

This migration fills all NULL rows with a cryptographically random 256-bit
URL-safe value using pgcrypto (encode(gen_random_bytes(32), 'base64')).
pgcrypto is confirmed active in this repo (see migration a51d7b0ab836 which
issues CREATE EXTENSION IF NOT EXISTS pgcrypto).

Pattern follows 4dffd7a49bef_backfill_attendee_products_payment_id.py:
a plain op.execute UPDATE that runs as the migration superuser, bypassing
RLS so it touches every tenant's popups in one statement.

Revision ID: 849f058ee25f
Revises: 5a73bd12eacb
"""

from collections.abc import Sequence

from alembic import op

revision: str = "849f058ee25f"
down_revision: str | Sequence[str] | None = "5a73bd12eacb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Ensure pgcrypto extension is available (idempotent guard).
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    # Fill NULL secrets with 256-bit base64-encoded random values.
    # WHERE guard ensures existing non-NULL secrets are never overwritten.
    op.execute(
        "UPDATE popups "
        "SET open_checkout_signing_secret = encode(gen_random_bytes(32), 'base64') "
        "WHERE open_checkout_signing_secret IS NULL"
    )


def downgrade() -> None:
    # No-op: re-NULLing the secrets would break live signed cart restore links
    # and invalidate any return-time release proofs already in flight.
    # This matches the 4dffd7a49bef downgrade rationale — information cannot
    # be safely removed once generated and distributed.
    pass
