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
    import secrets

    # Fill NULL secrets with 256-bit URL-safe base64 random values using a
    # Python loop so the alphabet matches secrets.token_urlsafe(32) exactly
    # (characters: A-Z a-z 0-9 - _; no + / or = padding).
    # pgcrypto's encode(..., 'base64') produces standard base64 which contains
    # + and / — unusable in query strings without percent-encoding and
    # inconsistent with the CRUD auto-provision path.
    connection = op.get_bind()
    popup_ids = connection.execute(
        __import__("sqlalchemy").text(
            "SELECT id FROM popups WHERE open_checkout_signing_secret IS NULL"
        )
    ).fetchall()
    for (popup_id,) in popup_ids:
        connection.execute(
            __import__("sqlalchemy").text(
                "UPDATE popups SET open_checkout_signing_secret = :secret "
                "WHERE id = :id AND open_checkout_signing_secret IS NULL"
            ),
            {"secret": secrets.token_urlsafe(32), "id": popup_id},
        )


def downgrade() -> None:
    # No-op: re-NULLing the secrets would break live signed cart restore links
    # and invalidate any return-time release proofs already in flight.
    # This matches the 4dffd7a49bef downgrade rationale — information cannot
    # be safely removed once generated and distributed.
    pass
