"""enrichment fact source label

Revision ID: cb6357be874e
Revises: 0795d50caaa6
Create Date: 2026-07-24

"""

import sqlalchemy as sa
from alembic import op

revision = "cb6357be874e"
down_revision = "0795d50caaa6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "human_enrichment_facts",
        sa.Column("source_label", sa.String(length=200), nullable=True),
    )


def downgrade():
    op.drop_column("human_enrichment_facts", "source_label")
