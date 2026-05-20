"""lowercase_emails: normalize stored emails to lowercase across users, humans, pending_humans.

Login lookups query by exact-equality on email (`Users.email == email`,
`Humans.email == email`, etc.) which is case-sensitive on PostgreSQL VARCHAR.
A user registered as `User@Example.com` could not log in as `user@example.com`.
Schemas now lowercase email on input; this migration backfills existing rows
so the in-DB representation matches what new requests will look up.

Detects pre-existing case collisions before mutating so we surface a clear
error instead of letting a unique-constraint violation abort mid-update.

Revision ID: d8f2e4a9c1b6
Revises: 370ff7f4e042
Create Date: 2026-05-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8f2e4a9c1b6"
down_revision: str = "370ff7f4e042"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _assert_no_collisions(conn, table: str, scope_cols: list[str]) -> None:
    """Raise if lowercasing `email` would produce a duplicate in (scope_cols, email)."""
    group_cols = [*scope_cols, "LOWER(email)"]
    group_by = ", ".join(group_cols)
    select_cols = ", ".join(scope_cols + ["LOWER(email) AS lower_email"])
    rows = conn.execute(
        sa.text(
            f"""
            SELECT {select_cols}, COUNT(*) AS n
            FROM {table}
            GROUP BY {group_by}
            HAVING COUNT(*) > 1
            """
        )
    ).all()
    if rows:
        raise RuntimeError(
            f"Cannot lowercase {table}.email: case-only duplicates exist. "
            f"Resolve manually before re-running. Offenders: {rows!r}"
        )


def upgrade() -> None:
    conn = op.get_bind()

    # users uniqueness post-migration a1b2c3d4e5f6 is (email, tenant_id) WHERE
    # deleted = false. Scope the collision check to that same partial index.
    rows = conn.execute(
        sa.text(
            """
            SELECT tenant_id, LOWER(email) AS lower_email, COUNT(*) AS n
            FROM users
            WHERE deleted = false
            GROUP BY tenant_id, LOWER(email)
            HAVING COUNT(*) > 1
            """
        )
    ).all()
    if rows:
        raise RuntimeError(
            f"Cannot lowercase users.email: case-only duplicates exist among "
            f"active users per tenant. Resolve manually before re-running. "
            f"Offenders: {rows!r}"
        )

    _assert_no_collisions(conn, "humans", ["tenant_id"])
    _assert_no_collisions(conn, "pending_humans", ["tenant_id"])

    op.execute(
        "UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email)"
    )
    op.execute(
        "UPDATE humans SET email = LOWER(email) WHERE email <> LOWER(email)"
    )
    op.execute(
        "UPDATE pending_humans SET email = LOWER(email) WHERE email <> LOWER(email)"
    )


def downgrade() -> None:
    # Lowercasing is lossy: original casing is not recoverable.
    pass
