"""Repair payment product identity constraint schema drift.

Revision ID: a6f4c8d2e9b1
Revises: e4a7c2d9b1f6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a6f4c8d2e9b1"
down_revision: str | Sequence[str] | None = "e4a7c2d9b1f6"
branch_labels = depends_on = None

_TABLE = "payment_products"
_LEGACY_CONSTRAINT = "ck_payment_product_has_recipient_or_attendee"
_COMPATIBILITY_CONSTRAINT = "ck_payment_product_fulfillment_identity_compatibility"
_IDENTITY_COMPATIBILITY = (
    "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
    "(fulfillment_type IN ('access', 'participant') AND "
    "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))"
)


def upgrade() -> None:
    constraint_names = {
        constraint["name"]
        for constraint in sa.inspect(op.get_bind()).get_check_constraints(_TABLE)
    }

    if _LEGACY_CONSTRAINT in constraint_names:
        op.drop_constraint(_LEGACY_CONSTRAINT, _TABLE, type_="check")

    if _COMPATIBILITY_CONSTRAINT not in constraint_names:
        op.create_check_constraint(
            _COMPATIBILITY_CONSTRAINT,
            _TABLE,
            _IDENTITY_COMPATIBILITY,
        )


def downgrade() -> None:
    # This revision only converges historical e4 schema drift. Reverting its
    # stamp must preserve e4's intended compatibility constraint because order
    # rows without recipient or Attendee identity may already exist.
    pass
