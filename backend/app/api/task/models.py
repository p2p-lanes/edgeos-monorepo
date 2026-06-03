"""ORM models for the in-app task tracker.

Product-level task tracking (bugs & features) for EdgeOS itself, administered
from the backoffice. Unlike almost every other table, ``tasks`` is GLOBAL — it
is NOT owned by a tenant. The ``visibility`` column governs *future* tenant
exposure (universal | tenant | internal); ``target_tenant_id`` scopes a task to
a single tenant when ``visibility == "tenant"``. In phase 1 the whole board is
superadmin-only and the visibility layer is dormant — the only door open to
non-superadmin staff is the "report a bug" endpoint, which always creates an
``internal`` bug.

Because the table is global it is reached exclusively through the privileged
main engine (``SessionDep``) with authorization enforced at the API layer; it
deliberately carries NO tenant RLS policy (see the migration for the rationale
and the phase-2 plan).

``task_comments`` is a flat discussion thread per task (soft-deleted, no
threading, no @mentions — backoffice has no notification channel yet).
``task_attachments`` holds screenshots / screen-recordings uploaded to S3 via
the shared ``/uploads/presigned-url`` flow; ``comment_id`` is reserved (always
NULL in v1) so an attachment can later hang off a comment without a migration.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, Relationship, SQLModel, func


class Task(SQLModel, table=True):
    """A single tracked task (bug or feature) for the EdgeOS product."""

    __tablename__ = "tasks"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    title: str = Field(max_length=200)
    detail: str | None = Field(default=None, sa_column=Column(Text, nullable=True))

    # See app.api.task.schemas: TaskStatus / TaskType / TaskPriority / TaskVisibility.
    status: str = Field(max_length=16, index=True)
    type: str = Field(max_length=16, index=True)
    # low | medium | high. Defaults to medium for existing/new rows.
    priority: str = Field(default="medium", max_length=16, index=True)

    # Assignee — any backoffice user. Nullable (e.g. fresh bug reports).
    responsible_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True, index=True
    )

    # Free-text release tag (e.g. "v1.2.0", "R42"). No Release entity yet.
    release: str | None = Field(default=None, max_length=50, nullable=True)

    # Future tenant-exposure control. Dormant in phase 1 (default internal).
    visibility: str = Field(default="internal", max_length=16, index=True)
    # Required only when visibility == "tenant"; else NULL.
    target_tenant_id: uuid.UUID | None = Field(
        default=None, foreign_key="tenants.id", nullable=True, index=True
    )

    # Stamped the first time the task enters the "published" status (changelog).
    published_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        ),
    )

    attachments: list["TaskAttachment"] = Relationship(
        back_populates="task",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    comments: list["TaskComment"] = Relationship(
        back_populates="task",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )


class TaskAttachment(SQLModel, table=True):
    """A screenshot or screen-recording attached to a task (stored in S3)."""

    __tablename__ = "task_attachments"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    task_id: uuid.UUID = Field(foreign_key="tasks.id", index=True)
    # Reserved for phase 2 (attach media to a specific comment). Always NULL now.
    comment_id: uuid.UUID | None = Field(
        default=None, foreign_key="task_comments.id", nullable=True
    )

    # S3 object key and public URL (from /uploads/presigned-url).
    storage_key: str = Field(sa_column=Column(Text, nullable=False))
    url: str = Field(sa_column=Column(Text, nullable=False))
    # "image" | "video" — drives the viewer (<img> vs <video controls>).
    media_type: str = Field(max_length=16)
    filename: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    size_bytes: int | None = Field(default=None, nullable=True)

    created_by: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )

    task: Task = Relationship(back_populates="attachments")


class TaskComment(SQLModel, table=True):
    """A single comment in a task's flat discussion thread.

    The author identity (name/email) is snapshotted at write time so the thread
    stays readable even if the user is later renamed or removed.
    """

    __tablename__ = "task_comments"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    task_id: uuid.UUID = Field(foreign_key="tasks.id", index=True)

    author_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )
    author_name: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    author_email: str | None = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )

    body: str = Field(sa_column=Column(Text, nullable=False))

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    # Set when the body is edited; surfaced as an "edited" marker in the UI.
    edited_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # Soft-delete: row is preserved, hidden from reads.
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    task: Task = Relationship(back_populates="comments")
