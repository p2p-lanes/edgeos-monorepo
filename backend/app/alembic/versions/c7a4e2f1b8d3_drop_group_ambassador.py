"""Drop ambassador group columns from groups.

Revision ID: c7a4e2f1b8d3
Revises: 5238a7bf67df
Create Date: 2026-06-16

Removes the legacy ambassador-group concept (replaced by referral links):
drops groups.is_ambassador_group, groups.ambassador_id and their indexes/FK.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "c7a4e2f1b8d3"
down_revision = "5238a7bf67df"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Dropping the columns cascades their dependent index/FK in PostgreSQL,
    # but drop them explicitly first for portability and a clean downgrade.
    op.drop_index("ix_groups_popup_ambassador", table_name="groups")
    op.drop_index("ix_groups_ambassador_id", table_name="groups")
    op.drop_constraint("groups_ambassador_id_fkey", "groups", type_="foreignkey")
    op.drop_column("groups", "ambassador_id")
    op.drop_column("groups", "is_ambassador_group")


def downgrade() -> None:
    op.add_column(
        "groups",
        sa.Column(
            "is_ambassador_group",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )
    op.add_column(
        "groups",
        sa.Column(
            "ambassador_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "groups_ambassador_id_fkey",
        "groups",
        "humans",
        ["ambassador_id"],
        ["id"],
    )
    op.create_index("ix_groups_ambassador_id", "groups", ["ambassador_id"])
    op.create_index(
        "ix_groups_popup_ambassador",
        "groups",
        ["popup_id", "is_ambassador_group"],
    )
