import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Text, func
from sqlmodel import Field, SQLModel


class CommentMixin(SQLModel):
    """Shared columns for a flat, soft-deletable comment thread.

    Concrete tables add their own ``id``, ``tenant_id`` and entity foreign key
    (e.g. ``human_id`` / ``application_id``). The author identity is snapshotted
    at write time so the thread stays readable even if the user is later renamed
    or removed.
    """

    author_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )
    author_name: str | None = Field(default=None, sa_type=Text, nullable=True)
    author_email: str | None = Field(default=None, sa_type=Text, nullable=True)

    body: str = Field(sa_type=Text, nullable=False)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_type=DateTime(timezone=True),
        sa_column_kwargs={"server_default": func.now(), "nullable": False},
    )
    # Set when the body is edited; surfaced as an "edited" marker in the UI.
    edited_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True), nullable=True
    )
    # Soft-delete: row is preserved, hidden from reads.
    deleted_at: datetime | None = Field(
        default=None, sa_type=DateTime(timezone=True), nullable=True
    )
