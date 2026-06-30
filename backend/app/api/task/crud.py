"""CRUD + serialization helpers for the task tracker.

The ``tasks`` table is global, so everything here runs on the privileged main
engine (``SessionDep``). Responsible/creator display names are resolved in a
single batched lookup to keep list responses free of N+1 queries.
"""

import uuid
from typing import TYPE_CHECKING

from sqlmodel import Session, col, func, select

from app.api.shared.crud import BaseCRUD
from app.api.shared.enums import UserRole
from app.api.task.models import Task, TaskComment
from app.api.task.schemas import (
    TaskAttachmentPublic,
    TaskCreate,
    TaskDetailPublic,
    TaskPublic,
    TaskUpdate,
    TaskVisibility,
)

if TYPE_CHECKING:
    from app.api.user.schemas import UserPublic


def can_view_task(user: "UserPublic", task: Task) -> bool:
    """Whether ``user`` may view ``task`` under its visibility.

    superadmin → everything; ``universal`` → everyone; ``tenant`` → users of the
    target tenant; ``internal`` → superadmins only.
    """
    if user.role == UserRole.SUPERADMIN:
        return True
    if task.visibility == TaskVisibility.UNIVERSAL.value:
        return True
    return (
        task.visibility == TaskVisibility.TENANT.value
        and task.target_tenant_id is not None
        and task.target_tenant_id == user.tenant_id
    )


class TasksCRUD(BaseCRUD[Task, TaskCreate, TaskUpdate]):
    """CRUD operations for Tasks."""

    def __init__(self) -> None:
        super().__init__(Task)

    def find_tasks(
        self,
        session: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        status: str | None = None,
        type: str | None = None,
        visibility: str | None = None,
        responsible_user_id: uuid.UUID | None = None,
        release: str | None = None,
        search: str | None = None,
        viewer: "UserPublic | None" = None,
        active_tenant_id: uuid.UUID | None = None,
        archived: bool | None = None,
    ) -> tuple[list[Task], int]:
        statement = select(Task)

        # Archive gate: ``False`` → active board (archived_at IS NULL),
        # ``True`` → the archive view, ``None`` → no filter (both).
        if archived is True:
            statement = statement.where(col(Task.archived_at).is_not(None))
        elif archived is False:
            statement = statement.where(col(Task.archived_at).is_(None))

        # Visibility gate for non-superadmin viewers: only universal tasks and
        # tenant tasks targeting their own tenant. internal tasks never reach
        # non-superadmins.
        if viewer is not None and viewer.role != UserRole.SUPERADMIN:
            statement = statement.where(
                (col(Task.visibility) == TaskVisibility.UNIVERSAL.value)
                | (
                    (col(Task.visibility) == TaskVisibility.TENANT.value)
                    & (col(Task.target_tenant_id) == viewer.tenant_id)
                )
            )
        # Superadmin with an active workspace (X-Tenant-Id) sees the board scoped
        # to that tenant: tenant tasks of other tenants are hidden, while global
        # tasks (universal/internal) stay visible. Without an active tenant the
        # superadmin keeps the cross-tenant view (no filter).
        elif active_tenant_id is not None:
            statement = statement.where(
                (col(Task.visibility) != TaskVisibility.TENANT.value)
                | (col(Task.target_tenant_id) == active_tenant_id)
            )

        if status is not None:
            statement = statement.where(Task.status == status)
        if type is not None:
            statement = statement.where(Task.type == type)
        if visibility is not None:
            statement = statement.where(Task.visibility == visibility)
        if responsible_user_id is not None:
            statement = statement.where(Task.responsible_user_id == responsible_user_id)
        if release is not None:
            statement = statement.where(Task.release == release)

        if search:
            term = f"%{search}%"
            statement = statement.where(
                col(Task.title).ilike(term) | col(Task.detail).ilike(term)
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        # Most-recently-touched first. Kanban columns reuse this ordering; the
        # frontend buckets the rows by status. No manual within-column ordering
        # in v1 (see the spec — `position` was intentionally dropped).
        statement = statement.order_by(col(Task.updated_at).desc())
        statement = statement.offset(skip).limit(limit)
        return list(session.exec(statement).all()), total


tasks_crud = TasksCRUD()


# --------------------------------------------------------------------------- #
# Serialization helpers
# --------------------------------------------------------------------------- #
def _user_name_map(
    session: Session, user_ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, tuple[str | None, str | None]]:
    """Resolve {user_id: (full_name, email)} for a batch of ids (one query)."""
    from app.api.user.models import Users

    ids = {uid for uid in user_ids if uid is not None}
    if not ids:
        return {}
    rows = session.exec(
        select(Users.id, Users.full_name, Users.email).where(col(Users.id).in_(ids))
    ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def to_public_list(session: Session, tasks: list[Task]) -> list[TaskPublic]:
    """Serialize tasks with resolved responsible/creator display names."""
    name_map = _user_name_map(
        session,
        [t.responsible_user_id for t in tasks] + [t.created_by for t in tasks],
    )
    result: list[TaskPublic] = []
    for task in tasks:
        pub = TaskPublic.model_validate(task)
        responsible = name_map.get(task.responsible_user_id)
        if responsible:
            pub.responsible_name, pub.responsible_email = responsible
        creator = name_map.get(task.created_by)
        if creator:
            pub.created_by_name = creator[0]
        result.append(pub)
    return result


def to_detail(session: Session, task: Task) -> TaskDetailPublic:
    """Serialize a single task with its attachments embedded."""
    base = to_public_list(session, [task])[0]
    data = base.model_dump()
    data["attachments"] = [
        TaskAttachmentPublic.model_validate(a) for a in task.attachments
    ]
    return TaskDetailPublic(**data)


def list_comments(session: Session, task_id: uuid.UUID) -> list[TaskComment]:
    """Return a task's non-deleted comments, oldest first."""
    statement = (
        select(TaskComment)
        .where(
            TaskComment.task_id == task_id,
            col(TaskComment.deleted_at).is_(None),
        )
        .order_by(col(TaskComment.created_at).asc())
    )
    return list(session.exec(statement).all())
