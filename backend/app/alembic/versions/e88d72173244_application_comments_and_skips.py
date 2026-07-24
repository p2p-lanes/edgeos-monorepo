"""application_comments and application_review_skips

Adds two tenant-scoped tables:

``application_comments`` — a flat review thread on an application, mirroring
``human_comments``. Reviewers leave shared notes visible to every operator,
decoupled from the per-vote ``application_reviews.notes``.

``application_review_skips`` — a per-reviewer skip flag. Skipping removes an
application from that one reviewer's pending queue without recording a vote, so
it never affects the approval tally. One skip per reviewer per application.

Both carry ``tenant_id`` + the standard tenant-isolation RLS policy and grants.

Revision ID: e88d72173244
Revises: 3d1b2dce2b7b
Create Date: 2026-07-23 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

# revision identifiers, used by Alembic.
revision = "e88d72173244"
down_revision = "3d1b2dce2b7b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) application_comments
    op.create_table(
        "application_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("application_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("author_name", sa.Text(), nullable=True),
        sa.Column("author_email", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name="fk_application_comments_application_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"],
            ["users.id"],
            name="fk_application_comments_author_user_id",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_application_comments_tenant_id",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_application_comments"),
    )
    op.create_index(
        "ix_application_comments_tenant_id",
        "application_comments",
        ["tenant_id"],
    )
    op.create_index(
        "ix_application_comments_application_id",
        "application_comments",
        ["application_id"],
    )
    add_tenant_table_permissions("application_comments")

    # 2) application_review_skips
    op.create_table(
        "application_review_skips",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("application_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name="fk_application_review_skips_application_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewer_id"],
            ["users.id"],
            name="fk_application_review_skips_reviewer_id",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_application_review_skips_tenant_id",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_application_review_skips"),
        sa.UniqueConstraint(
            "application_id", "reviewer_id", name="uq_review_skip_app_user"
        ),
    )
    op.create_index(
        "ix_application_review_skips_tenant_id",
        "application_review_skips",
        ["tenant_id"],
    )
    op.create_index(
        "ix_application_review_skips_application_id",
        "application_review_skips",
        ["application_id"],
    )
    op.create_index(
        "ix_application_review_skips_reviewer_id",
        "application_review_skips",
        ["reviewer_id"],
    )
    add_tenant_table_permissions("application_review_skips")


def downgrade() -> None:
    remove_tenant_table_permissions("application_review_skips")
    op.drop_index(
        "ix_application_review_skips_reviewer_id",
        table_name="application_review_skips",
    )
    op.drop_index(
        "ix_application_review_skips_application_id",
        table_name="application_review_skips",
    )
    op.drop_index(
        "ix_application_review_skips_tenant_id",
        table_name="application_review_skips",
    )
    op.drop_table("application_review_skips")

    remove_tenant_table_permissions("application_comments")
    op.drop_index(
        "ix_application_comments_application_id",
        table_name="application_comments",
    )
    op.drop_index(
        "ix_application_comments_tenant_id",
        table_name="application_comments",
    )
    op.drop_table("application_comments")
