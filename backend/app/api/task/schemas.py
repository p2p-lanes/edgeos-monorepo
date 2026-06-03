"""Schemas for the in-app task tracker."""

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class TaskStatus(str, Enum):
    TO_DO = "to_do"
    TESTING = "testing"
    NEXT_RELEASE = "next_release"
    PUBLISHED = "published"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class TaskType(str, Enum):
    BUG = "bug"
    FEATURE = "feature"


class TaskPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TaskVisibility(str, Enum):
    UNIVERSAL = "universal"  # all tenants (phase 2)
    TENANT = "tenant"  # a single target tenant (phase 2)
    INTERNAL = "internal"  # superadmins only


class TaskMediaType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"


# --------------------------------------------------------------------------- #
# Attachments
# --------------------------------------------------------------------------- #
class TaskAttachmentCreate(BaseModel):
    """Register an already-uploaded S3 object as a task attachment.

    The file itself is uploaded directly to S3 via POST /uploads/presigned-url;
    this just records the resulting key/url against the task.
    """

    storage_key: str
    url: str
    media_type: TaskMediaType
    filename: str | None = None
    size_bytes: int | None = None

    model_config = ConfigDict(use_enum_values=True)


class TaskAttachmentPublic(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    url: str
    media_type: TaskMediaType
    filename: str | None = None
    size_bytes: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Comments
# --------------------------------------------------------------------------- #
class TaskCommentCreate(BaseModel):
    body: str = Field(min_length=1)


class TaskCommentUpdate(BaseModel):
    body: str = Field(min_length=1)


class TaskCommentPublic(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    author_user_id: uuid.UUID | None = None
    author_name: str | None = None
    author_email: str | None = None
    body: str
    created_at: datetime
    edited_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- #
# Tasks
# --------------------------------------------------------------------------- #
class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    detail: str | None = None
    status: TaskStatus = TaskStatus.TO_DO
    type: TaskType = TaskType.FEATURE
    priority: TaskPriority = TaskPriority.MEDIUM
    responsible_user_id: uuid.UUID | None = None
    release: str | None = Field(default=None, max_length=50)
    visibility: TaskVisibility = TaskVisibility.INTERNAL
    target_tenant_id: uuid.UUID | None = None

    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    detail: str | None = None
    status: TaskStatus | None = None
    type: TaskType | None = None
    priority: TaskPriority | None = None
    responsible_user_id: uuid.UUID | None = None
    release: str | None = Field(default=None, max_length=50)
    visibility: TaskVisibility | None = None
    target_tenant_id: uuid.UUID | None = None

    model_config = ConfigDict(use_enum_values=True, str_strip_whitespace=True)


class TaskStatusUpdate(BaseModel):
    """Lightweight payload for moving a card between Kanban columns."""

    status: TaskStatus

    model_config = ConfigDict(use_enum_values=True)


class BugReportCreate(BaseModel):
    """The 'report a bug' payload, open to every backoffice user.

    Always produces an internal bug in the to-do column. Attachments are
    optional screenshots / screen-recordings already uploaded to S3.
    """

    title: str = Field(min_length=1, max_length=200)
    detail: str | None = None
    attachments: list[TaskAttachmentCreate] = Field(default_factory=list)

    model_config = ConfigDict(str_strip_whitespace=True)


class TaskPublic(BaseModel):
    id: uuid.UUID
    title: str
    detail: str | None = None
    status: TaskStatus
    type: TaskType
    priority: TaskPriority = TaskPriority.MEDIUM
    responsible_user_id: uuid.UUID | None = None
    responsible_name: str | None = None
    responsible_email: str | None = None
    release: str | None = None
    visibility: TaskVisibility
    target_tenant_id: uuid.UUID | None = None
    published_at: datetime | None = None
    created_by: uuid.UUID | None = None
    created_by_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskDetailPublic(TaskPublic):
    attachments: list[TaskAttachmentPublic] = Field(default_factory=list)
