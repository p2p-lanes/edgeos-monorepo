"""Add task tracker tables (tasks, task_comments, task_attachments).

In-app product task board for EdgeOS itself (bugs & features), administered
from the backoffice.

Unlike almost every other table, ``tasks`` is GLOBAL — NOT owned by a tenant.
The ``visibility`` column governs *future* tenant exposure (universal | tenant |
internal) and ``target_tenant_id`` scopes a task to one tenant when
``visibility = 'tenant'``. In phase 1 the whole board is superadmin-only.

Because the table is global it is reached exclusively through the privileged
main engine, with authorization enforced at the API layer. It therefore carries
NO tenant RLS policy and NO grants to the tenant DB roles — a tenant connection
has no privileges on these tables at all (deny-by-default).

PHASE 2 (not in this migration): to expose universal/tenant tasks to tenant
portals, add a read policy along the lines of
    visibility = 'universal'
    OR (visibility = 'tenant' AND target_tenant_id = app.tenant_id)
plus a SELECT grant to the tenant roles. ``internal`` tasks stay invisible.

Schema:
  tasks (
    id uuid PK,
    title varchar(200) NOT NULL,
    detail text NULL,
    status varchar(16) NOT NULL,          -- to_do|testing|next_release|published|blocked|cancelled
    type varchar(16) NOT NULL,            -- bug|feature
    responsible_user_id uuid NULL FK -> users(id),
    release varchar(50) NULL,
    visibility varchar(16) NOT NULL,      -- universal|tenant|internal
    target_tenant_id uuid NULL FK -> tenants(id),
    published_at timestamptz NULL,
    created_by uuid NULL FK -> users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )
  task_comments (
    id uuid PK,
    task_id uuid NOT NULL FK -> tasks(id) ON DELETE CASCADE,
    author_user_id uuid NULL FK -> users(id),
    author_name text NULL,
    author_email text NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz NULL,
    deleted_at timestamptz NULL           -- soft delete
  )
  task_attachments (
    id uuid PK,
    task_id uuid NOT NULL FK -> tasks(id) ON DELETE CASCADE,
    comment_id uuid NULL FK -> task_comments(id) ON DELETE CASCADE,  -- reserved (always NULL in v1)
    storage_key text NOT NULL,
    url text NOT NULL,
    media_type varchar(16) NOT NULL,      -- image|video
    filename text NULL,
    size_bytes integer NULL,
    created_by uuid NULL FK -> users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "f3a8c1d92e47"
down_revision = "7a3f9c1d8e2b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column(
            "responsible_user_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("release", sa.String(50), nullable=True),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column(
            "target_tenant_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["responsible_user_id"], ["users.id"], name="fk_tasks_responsible_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["target_tenant_id"], ["tenants.id"], name="fk_tasks_target_tenant_id"
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_tasks_created_by"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_tasks"),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_type", "tasks", ["type"])
    op.create_index("ix_tasks_visibility", "tasks", ["visibility"])
    op.create_index(
        "ix_tasks_responsible_user_id", "tasks", ["responsible_user_id"]
    )
    op.create_index("ix_tasks_target_tenant_id", "tasks", ["target_tenant_id"])
    op.create_index("ix_tasks_updated_at", "tasks", [sa.text("updated_at DESC")])

    op.create_table(
        "task_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
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
            ["task_id"],
            ["tasks.id"],
            name="fk_task_comments_task_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_user_id"], ["users.id"], name="fk_task_comments_author_user_id"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_task_comments"),
    )
    op.create_index(
        "ix_task_comments_task_created",
        "task_comments",
        ["task_id", "created_at"],
    )

    op.create_table(
        "task_attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("comment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("media_type", sa.String(16), nullable=False),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks.id"],
            name="fk_task_attachments_task_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["comment_id"],
            ["task_comments.id"],
            name="fk_task_attachments_comment_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name="fk_task_attachments_created_by"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_task_attachments"),
    )
    op.create_index(
        "ix_task_attachments_task_id", "task_attachments", ["task_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_task_attachments_task_id", table_name="task_attachments")
    op.drop_table("task_attachments")
    op.drop_index("ix_task_comments_task_created", table_name="task_comments")
    op.drop_table("task_comments")
    op.drop_index("ix_tasks_updated_at", table_name="tasks")
    op.drop_index("ix_tasks_target_tenant_id", table_name="tasks")
    op.drop_index("ix_tasks_responsible_user_id", table_name="tasks")
    op.drop_index("ix_tasks_visibility", table_name="tasks")
    op.drop_index("ix_tasks_type", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_table("tasks")
