"""Replace humans.red_flag with a rating enum and add human_comments.

Product change: the human "status" (a single ``red_flag`` boolean) becomes a
5-level admin ``rating`` — ``sin_calificar`` (default/neutral), ``red_flag``,
``orange_flag``, ``green_flag``, ``star``. Only ``red_flag`` keeps the blocking
cascade (revoke API keys, reject in-review applications, send rejection emails);
the other levels are advisory labels. The model keeps a derived ``red_flag``
property so existing gates that branch on the blocking state are unaffected.

``rating`` is stored as the enum's string value in a plain varchar column,
matching the project's convention for enums (e.g. application status).

Data migration: existing ``red_flag = true`` rows map to ``rating = 'red_flag'``;
everything else maps to ``rating = 'sin_calificar'``.

Also adds ``human_comments`` — a flat discussion thread per human that justifies
the rating, mirroring ``task_comments``. Like the task tables it is reached only
through the privileged main engine (authorization at the API layer), so it
carries NO tenant RLS policy and NO grants to the tenant DB roles.

Schema:
  humans.rating varchar(20) NOT NULL DEFAULT 'sin_calificar'   (red_flag dropped)
  human_comments (
    id uuid PK,
    human_id uuid NOT NULL FK -> humans(id) ON DELETE CASCADE,
    author_user_id uuid NULL FK -> users(id),
    author_name text NULL,
    author_email text NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz NULL,
    deleted_at timestamptz NULL           -- soft delete
  )
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "3c5f1a8e7d24"
down_revision = "2a7c9e4f1b6d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) humans.red_flag -> humans.rating
    op.add_column(
        "humans",
        sa.Column(
            "rating",
            sa.String(20),
            nullable=False,
            server_default="sin_calificar",
        ),
    )
    op.execute("UPDATE humans SET rating = 'red_flag' WHERE red_flag = true")
    op.drop_column("humans", "red_flag")

    # 2) human_comments (global table, privileged engine only — no RLS, no grants)
    op.create_table(
        "human_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("human_id", postgresql.UUID(as_uuid=True), nullable=False),
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
            ["human_id"],
            ["humans.id"],
            name="fk_human_comments_human_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"],
            ["users.id"],
            name="fk_human_comments_author_user_id",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_human_comments"),
    )
    op.create_index(
        "ix_human_comments_human_created",
        "human_comments",
        ["human_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_human_comments_human_created", table_name="human_comments")
    op.drop_table("human_comments")

    op.add_column(
        "humans",
        sa.Column(
            "red_flag",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute("UPDATE humans SET red_flag = true WHERE rating = 'red_flag'")
    op.drop_column("humans", "rating")
