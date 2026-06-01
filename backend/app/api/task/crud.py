"""CRUD + serialization helpers for the task tracker.

The ``tasks`` table is global, so everything here runs on the privileged main
engine (``SessionDep``). Responsible/creator display names are resolved in a
single batched lookup to keep list responses free of N+1 queries.
"""

import uuid

from sqlmodel import Session, col, func, select

from app.api.shared.crud import BaseCRUD
from app.api.task.models import Task, TaskComment
from app.api.task.schemas import (
    TaskAttachmentPublic,
    TaskCreate,
    TaskDetailPublic,
    TaskPublic,
    TaskUpdate,
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
    ) -> tuple[list[Task], int]:
        statement = select(Task)

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
