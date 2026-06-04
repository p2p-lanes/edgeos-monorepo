"""Task tracker API.

Board CRUD, attachments and comments are superadmin-only in phase 1. The single
exception is ``POST /tasks/report-bug``: open to every authenticated backoffice
user so anyone can file a bug (it always lands as an internal, to-do bug).

The ``tasks`` table is global, so every endpoint uses the privileged main engine
(``SessionDep``); authorization is enforced purely by the FastAPI dependency.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.api.shared.enums import UserRole
from app.api.shared.response import (
    ListModel,
    PaginationLimit,
    PaginationSkip,
    Paging,
)
from app.api.task import crud
from app.api.task.models import Task, TaskAttachment, TaskComment
from app.api.task.schemas import (
    BugReportCreate,
    TaskAttachmentCreate,
    TaskAttachmentPublic,
    TaskCommentCreate,
    TaskCommentPublic,
    TaskCommentUpdate,
    TaskCreate,
    TaskDetailPublic,
    TaskPublic,
    TaskStatus,
    TaskStatusUpdate,
    TaskType,
    TaskUpdate,
    TaskVisibility,
)
from app.core.dependencies.users import (
    CurrentSuperadmin,
    CurrentUser,
    SessionDep,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _validate_visibility(visibility: str, target_tenant_id: uuid.UUID | None) -> None:
    if visibility == TaskVisibility.TENANT.value and target_tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_tenant_id is required when visibility is 'tenant'",
        )


def _validate_responsible(
    db: SessionDep, responsible_user_id: uuid.UUID | None
) -> None:
    """Tasks may only be assigned to a superadmin (phase 1 policy)."""
    if responsible_user_id is None:
        return
    from app.api.user.models import Users

    user = db.get(Users, responsible_user_id)
    if not user or user.deleted or user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tasks can only be assigned to a superadmin",
        )


def _get_task_or_404(db: SessionDep, task_id: uuid.UUID) -> Task:
    task = crud.tasks_crud.get(db, task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return task


def _get_viewable_task_or_404(db: SessionDep, task_id: uuid.UUID, user) -> Task:
    """Like _get_task_or_404 but 404s when the user can't view it (no info leak)."""
    task = _get_task_or_404(db, task_id)
    if not crud.can_view_task(user, task):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found"
        )
    return task


# --------------------------------------------------------------------------- #
# Report a bug — open to every backoffice user
# --------------------------------------------------------------------------- #
@router.post(
    "/report-bug",
    response_model=TaskPublic,
    status_code=status.HTTP_201_CREATED,
)
async def report_bug(
    report_in: BugReportCreate,
    db: SessionDep,
    current_user: CurrentUser,
) -> TaskPublic:
    """File a bug report (any authenticated backoffice user).

    Creates a to-do bug attributed to the reporter, scoped to the reporter's
    tenant (``visibility='tenant'``) so that tenant's users can see it. A
    superadmin reporter (no tenant) falls back to an ``internal`` bug. Optional
    attachments are screenshots / screen-recordings already uploaded to S3 via
    POST /uploads/presigned-url.
    """
    if current_user.tenant_id is not None:
        visibility = TaskVisibility.TENANT.value
        target_tenant_id = current_user.tenant_id
    else:
        visibility = TaskVisibility.INTERNAL.value
        target_tenant_id = None

    task = Task(
        title=report_in.title,
        detail=report_in.detail,
        status=TaskStatus.TO_DO.value,
        type=TaskType.BUG.value,
        visibility=visibility,
        target_tenant_id=target_tenant_id,
        created_by=current_user.id,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    for attachment in report_in.attachments:
        db.add(
            TaskAttachment(
                **attachment.model_dump(),
                task_id=task.id,
                created_by=current_user.id,
            )
        )
    if report_in.attachments:
        db.commit()

    return crud.to_public_list(db, [task])[0]


# --------------------------------------------------------------------------- #
# Board CRUD — superadmin only
# --------------------------------------------------------------------------- #
@router.get("", response_model=ListModel[TaskPublic])
async def list_tasks(
    db: SessionDep,
    current_user: CurrentUser,
    task_status: TaskStatus | None = Query(default=None, alias="status"),
    task_type: TaskType | None = Query(default=None, alias="type"),
    visibility: TaskVisibility | None = None,
    responsible_user_id: uuid.UUID | None = None,
    release: str | None = None,
    search: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[TaskPublic]:
    """List tasks the current user may see (filtered by visibility)."""
    tasks, total = crud.tasks_crud.find_tasks(
        db,
        skip=skip,
        limit=limit,
        status=task_status.value if task_status else None,
        type=task_type.value if task_type else None,
        visibility=visibility.value if visibility else None,
        responsible_user_id=responsible_user_id,
        release=release,
        search=search,
        viewer=current_user,
    )
    return ListModel[TaskPublic](
        results=crud.to_public_list(db, tasks),
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("", response_model=TaskDetailPublic, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_in: TaskCreate,
    db: SessionDep,
    current_user: CurrentSuperadmin,
) -> TaskDetailPublic:
    """Create a task (superadmin only)."""
    _validate_visibility(task_in.visibility, task_in.target_tenant_id)
    _validate_responsible(db, task_in.responsible_user_id)

    data = task_in.model_dump()
    if data["visibility"] != TaskVisibility.TENANT.value:
        data["target_tenant_id"] = None

    task = Task(**data, created_by=current_user.id)
    if task.status == TaskStatus.PUBLISHED.value:
        task.published_at = datetime.now(UTC)

    db.add(task)
    db.commit()
    db.refresh(task)
    return crud.to_detail(db, task)


@router.get("/{task_id}", response_model=TaskDetailPublic)
async def get_task(
    task_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentUser,
) -> TaskDetailPublic:
    """Get a single task with its attachments (visible to the user)."""
    task = _get_viewable_task_or_404(db, task_id, current_user)
    return crud.to_detail(db, task)


@router.put("/{task_id}", response_model=TaskDetailPublic)
async def update_task(
    task_id: uuid.UUID,
    task_in: TaskUpdate,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> TaskDetailPublic:
    """Update a task (superadmin only)."""
    task = _get_task_or_404(db, task_id)

    update_data = task_in.model_dump(exclude_unset=True)

    new_visibility = update_data.get("visibility", task.visibility)
    new_target = update_data.get("target_tenant_id", task.target_tenant_id)
    _validate_visibility(new_visibility, new_target)
    if new_visibility != TaskVisibility.TENANT.value:
        update_data["target_tenant_id"] = None

    if "responsible_user_id" in update_data:
        _validate_responsible(db, update_data["responsible_user_id"])

    if (
        update_data.get("status") == TaskStatus.PUBLISHED.value
        and task.published_at is None
    ):
        task.published_at = datetime.now(UTC)

    for field, value in update_data.items():
        setattr(task, field, value)

    db.add(task)
    db.commit()
    db.refresh(task)
    return crud.to_detail(db, task)


@router.patch("/{task_id}/status", response_model=TaskPublic)
async def update_task_status(
    task_id: uuid.UUID,
    payload: TaskStatusUpdate,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> TaskPublic:
    """Move a card between Kanban columns (superadmin only)."""
    task = _get_task_or_404(db, task_id)

    task.status = payload.status
    if payload.status == TaskStatus.PUBLISHED.value and task.published_at is None:
        task.published_at = datetime.now(UTC)

    db.add(task)
    db.commit()
    db.refresh(task)
    return crud.to_public_list(db, [task])[0]


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: uuid.UUID,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> None:
    """Hard-delete a task and its comments/attachments (superadmin only).

    The lifecycle 'delete' is the ``cancelled`` status; this is for cleanup.
    """
    task = _get_task_or_404(db, task_id)
    crud.tasks_crud.delete(db, task)


# --------------------------------------------------------------------------- #
# Attachments — superadmin only
# --------------------------------------------------------------------------- #
@router.post(
    "/{task_id}/attachments",
    response_model=TaskAttachmentPublic,
    status_code=status.HTTP_201_CREATED,
)
async def add_attachment(
    task_id: uuid.UUID,
    attachment_in: TaskAttachmentCreate,
    db: SessionDep,
    current_user: CurrentSuperadmin,
) -> TaskAttachmentPublic:
    """Attach an already-uploaded S3 object to a task (superadmin only)."""
    _get_task_or_404(db, task_id)
    attachment = TaskAttachment(
        **attachment_in.model_dump(),
        task_id=task_id,
        created_by=current_user.id,
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return TaskAttachmentPublic.model_validate(attachment)


@router.delete(
    "/{task_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_attachment(
    task_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: SessionDep,
    _: CurrentSuperadmin,
) -> None:
    """Remove an attachment from a task (superadmin only)."""
    attachment = db.get(TaskAttachment, attachment_id)
    if not attachment or attachment.task_id != task_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )
    db.delete(attachment)
    db.commit()


# --------------------------------------------------------------------------- #
# Comments — superadmin only
# --------------------------------------------------------------------------- #
@router.get("/{task_id}/comments", response_model=ListModel[TaskCommentPublic])
async def list_task_comments(
    task_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentUser,
) -> ListModel[TaskCommentPublic]:
    """List a task's comments, oldest first (any user who can view the task)."""
    _get_viewable_task_or_404(db, task_id, current_user)
    comments = crud.list_comments(db, task_id)
    return ListModel[TaskCommentPublic](
        results=[TaskCommentPublic.model_validate(c) for c in comments],
        paging=Paging(offset=0, limit=len(comments), total=len(comments)),
    )


@router.post(
    "/{task_id}/comments",
    response_model=TaskCommentPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_task_comment(
    task_id: uuid.UUID,
    comment_in: TaskCommentCreate,
    db: SessionDep,
    current_user: CurrentUser,
) -> TaskCommentPublic:
    """Add a comment to a task (any user who can view the task)."""
    _get_viewable_task_or_404(db, task_id, current_user)
    comment = TaskComment(
        task_id=task_id,
        author_user_id=current_user.id,
        author_name=current_user.full_name,
        author_email=current_user.email,
        body=comment_in.body,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return TaskCommentPublic.model_validate(comment)


@router.put("/{task_id}/comments/{comment_id}", response_model=TaskCommentPublic)
async def update_task_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    comment_in: TaskCommentUpdate,
    db: SessionDep,
    current_user: CurrentUser,
) -> TaskCommentPublic:
    """Edit your own comment (any user who can view the task)."""
    _get_viewable_task_or_404(db, task_id, current_user)
    comment = db.get(TaskComment, comment_id)
    if not comment or comment.task_id != task_id or comment.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found"
        )
    if comment.author_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only edit your own comments",
        )
    comment.body = comment_in.body
    comment.edited_at = datetime.now(UTC)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return TaskCommentPublic.model_validate(comment)


@router.delete(
    "/{task_id}/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_task_comment(
    task_id: uuid.UUID,
    comment_id: uuid.UUID,
    db: SessionDep,
    current_user: CurrentUser,
) -> None:
    """Soft-delete a comment: the author, or any superadmin. Row is preserved."""
    _get_viewable_task_or_404(db, task_id, current_user)
    comment = db.get(TaskComment, comment_id)
    if not comment or comment.task_id != task_id or comment.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found"
        )
    if (
        current_user.role != UserRole.SUPERADMIN
        and comment.author_user_id != current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only delete your own comments",
        )
    comment.deleted_at = datetime.now(UTC)
    db.add(comment)
    db.commit()
