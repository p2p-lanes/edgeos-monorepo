"""Give a human's public profile a readable alias.

Revision ID: c3e5a7b9d1f2
Revises: 50c71da1e604

`username` is NULL for everyone until they pick one in the portal. It is
stored lowercased and unique per tenant, and serves the same profile as the
opaque share token at portal.<tenant>/<username>.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3e5a7b9d1f2"
down_revision: str | None = "50c71da1e604"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("humans", sa.Column("username", sa.String(30), nullable=True))
    op.create_unique_constraint(
        "uq_humans_tenant_username", "humans", ["tenant_id", "username"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_humans_tenant_username", "humans", type_="unique")
    op.drop_column("humans", "username")
