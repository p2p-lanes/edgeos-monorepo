"""Add auth_code_origin to humans for OTP origin tagging.

WHY:
The OTP code stored on Humans is shared across login flows (portal regular,
third-party). Without an origin tag, a code emitted by the third-party flow
can be redeemed via the portal flow, escalating from a scoped JWT to a full
portal:* JWT. Tagging each emitted code with its origin lets the verify path
enforce strict isolation per flow.

WHAT:
1. ADD COLUMN humans.auth_code_origin (String 20, nullable)

NULL means legacy / portal-origin (treated as portal during the grace
period to avoid breaking in-flight codes at deploy time).

Revision ID: 3e8f4a2b1c5d
Revises: 5e5739582c92
Create Date: 2026-05-20
"""

import sqlalchemy as sa
from alembic import op

revision = "3e8f4a2b1c5d"
down_revision = "5e5739582c92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "humans",
        sa.Column("auth_code_origin", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("humans", "auth_code_origin")
