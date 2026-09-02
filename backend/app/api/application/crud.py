import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException, status
from sqlalchemy import case, desc, exists, nullslast, or_
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from app.api.application.models import (
    ApplicationComment,
    Applications,
    ApplicationSnapshots,
)
from app.api.application.schemas import (
    CUSTOM_FIELD_PREFIX,
    HUMAN_FILTER_FIELDS,
    VIRTUAL_REVIEWER_FIELDS,
    ApplicationAdminCreate,
    ApplicationCommentCreate,
    ApplicationCommentUpdate,
    ApplicationCreate,
    ApplicationFilterCondition,
    ApplicationFilters,
    ApplicationStatus,
    ApplicationUpdate,
    PopupAccessResponse,
    ScholarshipDecisionRequest,
    ScholarshipStatus,
)
from app.api.application_review.models import (
    ApplicationReviews,
    ApplicationReviewSkips,
)
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.human.schemas import HumanCreate, HumanUpdate
from app.api.shared.crud import BaseCRUD
from app.core.filters import build_filter_expression, text_condition_expression

if TYPE_CHECKING:
    from app.api.human.models import Humans
    from app.api.sales_flow.models import SalesFlows


# Attendee categories shown in the Portal attendee directory. Kids (and any
# other non-adult categories) are intentionally excluded — only the main
# applicant and their spouse appear.
DIRECTORY_VISIBLE_CATEGORY_KEYS = ("main", "spouse")

# Default ``info_not_shared`` for applications materialized by an admin grant
# (comped/gifted tickets): every field the directory can mask. The recipient
# never filled the form, so nothing is shared until they opt in themselves.
GRANTED_DEFAULT_INFO_NOT_SHARED = (
    "first_name",
    "last_name",
    "email",
    "telegram",
    "role",
    "organization",
    "residence",
    "age",
    "gender",
)


def _is_draft_status(status_value: object) -> bool:
    """True when an application is being created/saved as a draft.

    Treats a missing status as draft because the DB column defaults to draft
    when no value is provided.
    """
    if status_value is None:
        return True
    return getattr(status_value, "value", status_value) == ApplicationStatus.DRAFT.value


def _filter_condition_expression(
    condition: ApplicationFilterCondition,
    reviewer_id: uuid.UUID | None = None,
):
    """Application-specific conditions; None delegates to the shared engine.

    Handles the virtual reviewer fields, the reviewed_by EXISTS, custom.*
    JSONB accessors, status, and the Humans-join fields. Standard columns
    (dates, text, booleans) fall through to the engine defaults.
    """
    if condition.field in VIRTUAL_REVIEWER_FIELDS:
        # Same EXISTS shape as find_pending_review, scoped to the current user.
        model = (
            ApplicationReviewSkips
            if condition.field == "skipped_by_me"
            else ApplicationReviews
        )
        has_row = (
            exists()
            .where(model.application_id == Applications.id)
            .where(model.reviewer_id == reviewer_id)
        )
        return has_row if condition.value else ~has_row

    if condition.field == "reviewed_by":
        # Any-reviewer variant: independent of the calling user's reviewer_id.
        has_row = (
            exists()
            .where(ApplicationReviews.application_id == Applications.id)
            .where(ApplicationReviews.reviewer_id == condition.uuid_value)
        )
        return has_row if condition.op == "eq" else ~has_row

    custom_name = condition.custom_field_name
    if custom_name is not None:
        # JSONB accessor keeps the field name a bound parameter, never raw SQL.
        column = col(Applications.custom_fields)[custom_name].astext
        return text_condition_expression(column, condition.op, condition.value)

    if condition.field == "status":
        if condition.op == "eq":
            return Applications.status == condition.value
        return Applications.status != condition.value

    if condition.field in HUMAN_FILTER_FIELDS:
        column = col(getattr(Humans, condition.field))
        return text_condition_expression(column, condition.op, condition.value)

    return None


def build_application_filter_expression(
    filters: ApplicationFilters,
    reviewer_id: uuid.UUID | None = None,
):
    """Combine the filter group into one boolean expression (None when empty).

    ``reviewer_id`` resolves the per-current-user virtual fields
    (skipped_by_me, reviewed_by_me); using them without it is a 422.
    """
    if reviewer_id is None:
        for condition in filters.conditions:
            if condition.field in VIRTUAL_REVIEWER_FIELDS:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Filtering by '{condition.field}' requires a signed-in user."
                    ),
                )
    return build_filter_expression(
        filters,
        Applications,
        condition_override=lambda c: _filter_condition_expression(c, reviewer_id),
    )


# Fields the group-counts endpoint may group by, split by source table.
GROUP_BY_APPLICATION_FIELDS = frozenset({"status", "scholarship_status"})
GROUP_BY_HUMAN_FIELDS = frozenset({"gender", "age"})
GROUP_BY_REVIEWER_FIELD = "reviewed_by"


def _group_by_expression(group_by: str):
    """Resolve a ``group_by`` key into (SQL expression, needs Humans join).

    ``custom.<name>`` targets custom_fields[<name>]; the name stays a bound
    parameter through the JSONB accessor, never raw SQL. Unsupported keys
    raise a user-oriented 422.
    """
    if group_by.startswith(CUSTOM_FIELD_PREFIX):
        name = group_by[len(CUSTOM_FIELD_PREFIX) :]
        if name:
            return col(Applications.custom_fields)[name].astext, False
    elif group_by in GROUP_BY_APPLICATION_FIELDS:
        return col(getattr(Applications, group_by)), False
    elif group_by in GROUP_BY_HUMAN_FIELDS:
        return col(getattr(Humans, group_by)), True
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"Grouping by '{group_by}' is not supported.",
    )


def _reviewer_group_scope_clause(group_value: str | None):
    """Select applications reviewed by one user, or by no users when omitted."""
    has_any_review = exists().where(
        ApplicationReviews.application_id == Applications.id
    )
    if group_value is None:
        return ~has_any_review
    try:
        reviewer_id = uuid.UUID(group_value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The reviewer group value must be a valid user id.",
        ) from None
    return has_any_review.where(ApplicationReviews.reviewer_id == reviewer_id)


def _group_scope_clause(group_by: str, group_value: str | None):
    """Boolean clause selecting one bucket of a grouped view.

    Same NULL/empty-string collapsing as ``count_by_group``: omitting the
    value selects the NULL bucket. Returns (clause, needs Humans join).
    """
    if group_by == GROUP_BY_REVIEWER_FIELD:
        return _reviewer_group_scope_clause(group_value), False
    expression, needs_human = _group_by_expression(group_by)
    bucket = func.nullif(expression, "")
    clause = bucket.is_(None) if group_value is None else bucket == group_value
    return clause, needs_human


def _scholarship_status_for_request(scholarship_request: bool) -> str | None:
    """Keep the persisted scholarship status aligned with the request flag."""
    return ScholarshipStatus.PENDING.value if scholarship_request else None


class RedFlaggedHumanError(Exception):
    """Raised when attempting to accept an application from a red-flagged human."""

    pass


class ApplicationsCRUD(BaseCRUD[Applications, ApplicationCreate, ApplicationUpdate]):
    """CRUD operations for Applications."""

    def __init__(self) -> None:
        super().__init__(Applications)

    def get_by_human_popup(
        self, session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
    ) -> Applications | None:
        """Get an application by human_id and popup_id.

        Popup-scoped, not flow-scoped — legitimate for reads where "does
        this human already participate in this popup, in any flow" is the
        actual question (access-ladder checks, invite redemption, "my
        application" lookups). NOT used by the duplicate-creation guards
        (see `get_by_human_flow`) since sdd/sales-flows slice 5 (G2).

        Deterministic selection: after the re-key, a human can legitimately
        hold 2+ applications for one popup (one per flow). Priority:
        accepted status first, then most recent `submitted_at` (NULLs
        last), then id as a tiebreaker — reads/mutations always resolve to
        the same row.
        """

        accepted_first = case(
            (Applications.status == ApplicationStatus.ACCEPTED.value, 0), else_=1
        )
        statement = (
            select(Applications)
            .where(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
            )
            .order_by(
                accepted_first,
                nullslast(desc(Applications.submitted_at)),
                desc(Applications.id),
            )
        )
        return session.exec(statement).first()

    def get_by_human_flow(
        self, session: Session, human_id: uuid.UUID, sales_flow_id: uuid.UUID
    ) -> Applications | None:
        """Get an application by human_id and sales_flow_id.

        Design: sdd/sales-flows slice 5, human checkpoint G2 (confirmed
        2026-08-04) — one application per person PER FLOW, not per popup.
        Used by the duplicate-creation guards.
        """

        statement = select(Applications).where(
            Applications.human_id == human_id,
            Applications.sales_flow_id == sales_flow_id,
        )
        return session.exec(statement).first()

    def resolve_target_flow_id(
        self,
        session: Session,
        popup_id: uuid.UUID,
        explicit_flow_id: uuid.UUID | None = None,
    ) -> uuid.UUID | None:
        """Resolve the flow id to stamp on a new application, honoring an
        explicit target when given (sdd/sales-flows task 9.7).

        `explicit_flow_id` must belong to `popup_id` and be
        `type=application` — raises 404 otherwise (mirrors every other
        `_get_flow_or_404` in this SDD change; a client-supplied flow id is
        always ownership-checked). Omitted means the popup's default flow.
        """

        if explicit_flow_id is None:
            return self.resolve_creation_flow_id(session, popup_id)

        from app.api.sales_flow.crud import sales_flows_crud
        from app.api.sales_flow.schemas import SalesFlowType

        flow = sales_flows_crud.get(session, explicit_flow_id)
        if (
            not flow
            or flow.popup_id != popup_id
            or flow.type != SalesFlowType.application
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found for this popup",
            )
        # A closed way in stops taking new applications. It is dropped from
        # the portal listing at the same time, so nobody arrives here by
        # clicking — but this endpoint takes the flow id from the client, and
        # a link somebody kept is enough to reach it.
        if flow.status is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This way in is closed and is not taking applications",
            )
        return flow.id

    def resolve_creation_flow_id(
        self, session: Session, popup_id: uuid.UUID
    ) -> uuid.UUID:
        """The flow a new application is stamped with when none was named.

        Since sdd/sales-flows-rediseno F4 `applications.sales_flow_id` is NOT
        NULL, a popup without a compatibility default cannot serve this legacy
        entry point. Named application flows remain available.
        """

        from app.api.sales_flow.crud import sales_flows_crud

        default_flow = sales_flows_crud.get_default_flow(session, popup_id)
        if default_flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )
        return default_flow.id

    def find_by_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Applications], int]:
        """Find applications by human_id with eager loading."""

        base_statement = select(Applications).where(Applications.human_id == human_id)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        status_filter: ApplicationStatus | None = None,
        search: str | None = None,
        reviewed_by: uuid.UUID | None = None,
        filters: ApplicationFilters | None = None,
        reviewer_id: uuid.UUID | None = None,
        group_by: str | None = None,
        group_value: str | None = None,
        sub_group_by: str | None = None,
        sub_group_value: str | None = None,
    ) -> tuple[list[Applications], int]:
        """Find applications by popup_id with optional status filter and eager loading.

        ``reviewer_id`` is the calling user's id, used only by the virtual
        per-user filter fields (skipped_by_me, reviewed_by_me).

        ``group_by``/``group_value`` scope the list to one bucket of a
        grouped view, using the same field whitelist and NULL/empty-string
        collapsing as ``count_by_group``; ``sub_group_by``/``sub_group_value``
        narrow it further to one subgroup bucket. Scopes are ANDed with
        everything else, so they stay correct even when ``filters`` uses
        match=any. A value is ignored when its field is not set; with a
        field set and no value the NULL bucket is selected.
        """

        # Each grouped-view scope becomes a plain WHERE clause; either may
        # require the Humans join.
        scope_clauses = []
        scopes_need_human = False
        for scope_field, scope_value in (
            (group_by, group_value),
            (sub_group_by, sub_group_value),
        ):
            if scope_field is None:
                continue
            clause, needs_human = _group_scope_clause(scope_field, scope_value)
            scope_clauses.append(clause)
            scopes_need_human = scopes_need_human or needs_human

        base_statement = select(Applications).where(Applications.popup_id == popup_id)

        if status_filter:
            base_statement = base_statement.where(
                Applications.status == status_filter.value
            )

        # Join Humans once, whether needed by a group scope, text search,
        # a human-field filter condition, or any combination.
        needs_human_join = (
            scopes_need_human
            or bool(search)
            or bool(filters and filters.references_human_fields())
        )
        if needs_human_join:
            base_statement = base_statement.join(
                Humans,
                Applications.human_id == Humans.id,  # type: ignore[arg-type]
            )

        # Apply text search if provided - search in human fields
        if search:
            search_term = f"%{search}%"
            base_statement = base_statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                )
            )

        if filters is not None:
            filter_expression = build_application_filter_expression(
                filters, reviewer_id
            )
            if filter_expression is not None:
                base_statement = base_statement.where(filter_expression)

        for clause in scope_clauses:
            base_statement = base_statement.where(clause)

        if reviewed_by:
            has_review = (
                exists()
                .where(ApplicationReviews.application_id == Applications.id)
                .where(ApplicationReviews.reviewer_id == reviewed_by)
            )
            base_statement = base_statement.where(has_review)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
                selectinload(Applications.reviews),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def count_by_group(
        self,
        session: Session,
        popup_id: uuid.UUID,
        group_by: str,
        search: str | None = None,
        filters: ApplicationFilters | None = None,
        reviewer_id: uuid.UUID | None = None,
        parent_group_by: str | None = None,
        parent_group_value: str | None = None,
    ) -> list[tuple[str | None, int]]:
        """Count a popup's applications grouped by one field.

        Same base statement as ``find_by_popup`` (popup scope + search +
        filters), grouped over ``nullif(expr, '')`` so NULL and empty string
        collapse into one None bucket. Rows come back ordered by count
        descending. ``reviewer_id`` resolves the virtual per-user filter
        fields, exactly like the list endpoint.

        ``parent_group_by``/``parent_group_value`` scope the counts to one
        bucket of an outer grouped view, so a subgrouped view can count
        within each expanded parent group.
        """
        group_needs_human = False
        if group_by == GROUP_BY_REVIEWER_FIELD:
            bucket = col(ApplicationReviews.reviewer_id)
            count_expression = func.count(func.distinct(Applications.id))
        else:
            group_expression, group_needs_human = _group_by_expression(group_by)
            bucket = func.nullif(group_expression, "")
            count_expression = func.count()

        parent_clause = None
        parent_needs_human = False
        if parent_group_by is not None:
            parent_clause, parent_needs_human = _group_scope_clause(
                parent_group_by, parent_group_value
            )

        statement = (
            select(bucket, count_expression)
            .select_from(Applications)
            .where(Applications.popup_id == popup_id)
        )
        if group_by == GROUP_BY_REVIEWER_FIELD:
            statement = statement.outerjoin(
                ApplicationReviews,
                ApplicationReviews.application_id == Applications.id,
            )
        if parent_clause is not None:
            statement = statement.where(parent_clause)

        # Join Humans once, whether needed by the group field, text search,
        # a human-field filter condition, or any combination.
        needs_human_join = (
            group_needs_human
            or parent_needs_human
            or bool(search)
            or bool(filters and filters.references_human_fields())
        )
        if needs_human_join:
            statement = statement.join(
                Humans,
                Applications.human_id == Humans.id,  # type: ignore[arg-type]
            )

        if search:
            search_term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                )
            )

        if filters is not None:
            filter_expression = build_application_filter_expression(
                filters, reviewer_id
            )
            if filter_expression is not None:
                statement = statement.where(filter_expression)

        statement = statement.group_by(bucket).order_by(count_expression.desc())
        return list(session.exec(statement).all())

    def reviewer_ids_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
    ) -> list[uuid.UUID]:
        """Return every user who has submitted a review for a popup."""
        statement = (
            select(ApplicationReviews.reviewer_id)
            .join(Applications, ApplicationReviews.application_id == Applications.id)
            .where(Applications.popup_id == popup_id)
            .distinct()
        )
        return list(session.exec(statement).all())

    def find_by_status(
        self,
        session: Session,
        status_filter: ApplicationStatus,
        popup_id: uuid.UUID | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Applications], int]:
        """Find applications by status with optional popup filter and eager loading."""

        base_statement = select(Applications).where(
            Applications.status == status_filter.value
        )

        if popup_id:
            base_statement = base_statement.where(Applications.popup_id == popup_id)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_pending_review(
        self,
        session: Session,
        reviewer_id: uuid.UUID,
        popup_ids: list[uuid.UUID] | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Applications], int]:
        """Find IN_REVIEW applications the reviewer has not reviewed yet.

        The reviewed-by-me exclusion and pagination run in SQL so the count is
        exact and no oversized candidate list is loaded into Python.

        TODO (sdd/sales-flows, deferred from slice 14 — disclosed, not
        forgotten): this queue is scoped by `popup_ids` only, with no
        `sales_flow_id`/`reviewers_mode` awareness (design D4's tri-state).
        A reviewer added only at a flow's OVERRIDE tier currently sees every
        IN_REVIEW application across the whole popup, not just the flows
        they're actually assigned to — the queue doesn't yet resolve, per
        application, whether its flow's `reviewers_mode` is inherit or
        override and filter accordingly. Fixing this correctly also touches
        the reviewers_mode flip's concurrency story (two reviewers editing
        the same flow's override list at once), which should use the
        `with_for_update` precedent already established in
        `payment/crud.py`'s pending-payment locking, not be bolted onto this
        read path ad hoc. Deferred as its own reviewed slice — this queue is
        a hot, constantly-polled surface and this final slice already spans
        3 services; disclosed rather than bundled in under time pressure.

        TODO (disclosed): `approval_strategy` also resolves flow -> popup
        with no admin write path for the flow tier (see
        `approval_strategy/crud.py::get_by_flow`) — the same shape of gap
        as `reviewers_mode` above: backend-supported, admin-inaccessible.
        """

        already_reviewed = (
            exists()
            .where(ApplicationReviews.application_id == Applications.id)
            .where(ApplicationReviews.reviewer_id == reviewer_id)
        )
        # This reviewer skipped the app: drop it from their queue only, without
        # touching the vote tally.
        already_skipped = (
            exists()
            .where(ApplicationReviewSkips.application_id == Applications.id)
            .where(ApplicationReviewSkips.reviewer_id == reviewer_id)
        )
        base_statement = select(Applications).where(
            Applications.status == ApplicationStatus.IN_REVIEW.value,
            ~already_reviewed,
            ~already_skipped,
        )

        if popup_ids is not None:
            base_statement = base_statement.where(
                col(Applications.popup_id).in_(popup_ids)
            )

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            base_statement.options(
                selectinload(Applications.attendees)  # type: ignore[arg-type]
                .selectinload(Attendees.attendee_products)  # type: ignore[arg-type]
                .selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(Applications.attendees).selectinload(  # type: ignore[arg-type]
                    Attendees.category_ref  # type: ignore[arg-type]
                ),
                selectinload(Applications.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Applications.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_directory(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        q: str | None = None,
    ) -> tuple[list[Attendees], int]:
        """Find attendees for the attendees directory.

        Returns ticket-holding attendees whose parent application is accepted —
        one entry per person, sourced from that attendee's own Human record.
        Only the main applicant and spouse categories are listed; kids (and any
        other categories) are excluded. Supports text search across the
        attendee's own human fields.
        """

        # Root on attendees so the spouse appears as their own row, not just
        # nested under the main applicant. Gate on an accepted parent
        # application, on the attendee holding at least one product, and on the
        # category being directory-visible (main/spouse — kids are excluded).
        has_products = exists().where(
            AttendeeProducts.attendee_id == Attendees.id,
            AttendeeProducts.revoked_at.is_(None),
            AttendeeProducts.product_category_snapshot == "ticket",
        )
        base_statement = (
            select(Attendees)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .join(
                AttendeeCategories,
                Attendees.category_id == AttendeeCategories.id,  # type: ignore[arg-type]
            )
            .where(Attendees.popup_id == popup_id)
            .where(Applications.status == ApplicationStatus.ACCEPTED.value)
            .where(has_products)
            .where(col(AttendeeCategories.key).in_(DIRECTORY_VISIBLE_CATEGORY_KEYS))
        )

        # Text search across the attendee's OWN human fields, so companions are
        # searchable by their own name/email — not the main applicant's.
        if q:
            search_term = f"%{q}%"
            base_statement = base_statement.join(
                Humans,
                Attendees.human_id == Humans.id,  # type: ignore[arg-type]
            ).where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    # Full name ("first last") so a query spanning both fields —
                    # e.g. "eva shang" — matches; the per-field checks above only
                    # catch a term that fits within a single column.
                    func.concat_ws(" ", Humans.first_name, Humans.last_name).ilike(
                        search_term
                    ),
                    col(Humans.email).ilike(search_term),
                    col(Humans.telegram).ilike(search_term),
                )
            )

        # Count
        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load: the attendee's tickets+products, its category, the parent
        # application (for main-applicant masking/custom_fields). human is
        # already selectin-loaded on the relationship.
        statement = (
            base_statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # type: ignore[arg-type]
                ),
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
                selectinload(Attendees.application),  # type: ignore[arg-type]
                selectinload(Attendees.human),  # type: ignore[arg-type]
            )
            .order_by(desc(Attendees.created_at))  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_directory_humans(
        self,
        session: Session,
        popup_id: uuid.UUID,
        q: str | None = None,
        skip: int = 0,
        limit: int = 20,
    ) -> tuple[list["Humans"], int]:
        """Find humans in the Portal attendee directory who share their name.

        Same population as ``find_directory`` (accepted application, the attendee
        holds at least one product, directory-visible main/spouse category) but
        returns the distinct underlying Humans instead of Attendee rows. Powers
        the event host picker: a creator may only pick a host who actually
        attends this popup AND has not hidden their name for it.

        Applications that listed "first_name" or "last_name" in
        ``info_not_shared`` are excluded — picking them would surface a name the
        attendee chose to hide. Humans with no usable name are also excluded so
        the picker never renders a blank entry. Optional ``q`` does an ilike
        match on the human's first/last name.
        """

        has_products = exists().where(
            AttendeeProducts.attendee_id == Attendees.id,
            AttendeeProducts.revoked_at.is_(None),
            AttendeeProducts.product_category_snapshot == "ticket",
        )
        # info_not_shared is a Postgres text[] column, so name-hiding is detected
        # with the array-overlap operator (&&): true when the list shares any
        # element with {first_name, last_name}. (?| is a JSONB operator and does
        # NOT apply to a real array column.) Negated to EXCLUDE those rows.
        hides_name = col(Applications.info_not_shared).op("&&")(
            postgresql.array(("first_name", "last_name"))
        )
        has_name = or_(
            func.trim(func.coalesce(col(Humans.first_name), "")) != "",
            func.trim(func.coalesce(col(Humans.last_name), "")) != "",
        )

        base_statement = (
            select(Humans)
            .join(Attendees, Attendees.human_id == Humans.id)  # type: ignore[arg-type]
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .join(
                AttendeeCategories,
                Attendees.category_id == AttendeeCategories.id,  # type: ignore[arg-type]
            )
            .where(Attendees.popup_id == popup_id)
            .where(Applications.status == ApplicationStatus.ACCEPTED.value)
            .where(has_products)
            .where(col(AttendeeCategories.key).in_(DIRECTORY_VISIBLE_CATEGORY_KEYS))
            .where(~hides_name)
            .where(has_name)
        )

        if q:
            search_term = f"%{q}%"
            base_statement = base_statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    # Full name so "first last" queries match (see find_directory).
                    func.concat_ws(" ", Humans.first_name, Humans.last_name).ilike(
                        search_term
                    ),
                )
            )

        distinct_statement = base_statement.distinct()
        count_statement = select(func.count()).select_from(
            distinct_statement.subquery()
        )
        total = session.exec(count_statement).one()

        results = list(session.exec(distinct_statement.offset(skip).limit(limit)).all())
        return results, total

    def human_ids_hiding_name(
        self,
        session: Session,
        popup_id: uuid.UUID,
        human_ids: list[uuid.UUID],
    ) -> set[uuid.UUID]:
        """Return the subset of ``human_ids`` who hid their name for ``popup_id``.

        A human hides their name when their Application for the popup lists
        "first_name" or "last_name" in ``info_not_shared``. Used to drop those
        people from portal-facing participant/RSVP lists.
        """

        if not human_ids:
            return set()

        hides_name = col(Applications.info_not_shared).op("&&")(
            postgresql.array(("first_name", "last_name"))
        )
        statement = (
            select(Applications.human_id)
            .where(Applications.popup_id == popup_id)
            .where(col(Applications.human_id).in_(human_ids))
            .where(hides_name)
        )
        return set(session.exec(statement).all())

    def create_internal(
        self,
        session: Session,
        app_data: ApplicationCreate | ApplicationAdminCreate,
        tenant_id: uuid.UUID,
        human_id: uuid.UUID,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Create an application with internal fields.

        This also updates the Human's profile with any provided profile fields.
        """
        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud
        from app.api.popup.crud import popups_crud
        from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

        # Get popup for check-in code prefix
        popup = popups_crud.get(session, app_data.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # Popup feature-flag guards for invite/referral paths (T-gr-017).
        # These flags gate whether the invite/referral modules are active for
        # this popup. Checked early so we fail fast before any DB lookups.
        if (
            getattr(app_data, "invite_id", None)
            and not config_for(
                session,
                sales_flow_id=getattr(app_data, "sales_flow_id", None),
                popup_id=popup.id,
            ).invites_enabled
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invite-based applications are not enabled for this popup",
            )
        if (
            getattr(app_data, "referral_id", None)
            and not config_for(
                session,
                sales_flow_id=getattr(app_data, "sales_flow_id", None),
                popup_id=popup.id,
            ).referrals_enabled
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Referral-based applications are not enabled for this popup",
            )

        # Drafts are partial saves: skip "required field is missing" checks but
        # still validate types/constraints on any values the user did provide.
        is_draft = _is_draft_status(getattr(app_data, "status", None))

        # Resolve group early so we can read explicit flags. The whitelist
        # validation below re-uses this same object (no second DB hit).
        _group_id = getattr(app_data, "group_id", None)
        _group = None
        if _group_id:
            from app.api.group.crud import groups_crud as _groups_crud

            _group = _groups_crud.get(session, _group_id)

        # REQ-GR-003 guard chain: expiry + use-limit checked here. Email match
        # is deferred until after human is fetched below.
        _invite_id = getattr(app_data, "invite_id", None)
        _invite = None
        if _invite_id:
            from app.api.invite.crud import invites_crud as _invites_crud

            _invite = _invites_crud.get_admin_created(session, _invite_id)
            if not _invite:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Invite not found",
                )
            # Steps 1 + 2: expiry → max_uses (reuse shared validate_for_redemption)
            _invites_crud.validate_for_redemption(_invite)

        # Resolve referral when referral_id is provided (REQ-GR-009/010).
        # Resolved here, alongside group and invite, because the express
        # checkout scope below depends on it. Uses are incremented later, once
        # the application is actually being committed.
        _referral_id = getattr(app_data, "referral_id", None)
        _referral = None
        if _referral_id:
            from app.api.invite.crud import invites_crud as _links_crud

            _referral = _links_crud.get_portal_created(session, _referral_id)
            if not _referral:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Referral not found",
                )
            # Validate the referral is still usable (disabled + expiry + limit)
            _links_crud.validate_for_redemption(_referral)

        # Express Checkout scope is a property of the ENTRY FLOW, not of the
        # link that opened it: the portal renders the reduced mini-form for
        # every group / invite / referral entry point (PersonalInfoForm ->
        # getCheckoutMiniFormSchema), unconditionally. Validating against the
        # full form here would reject required fields the applicant was never
        # shown -- which is exactly what referral links hit, since Referrals
        # has no express_checkout column to opt in with.
        #
        # This supersedes T-gr-016 / Design Decision 1f, which made the scope
        # depend on the per-link group.express_checkout / invite.express_checkout
        # flags. Those flags never reached the portal, so the two sides could
        # disagree. The columns are intentionally left in place: express
        # checkout is moving to per-popup configuration, and that change decides
        # their fate.
        is_express_checkout = bool(_group or _invite or _referral)

        # Validate custom_fields against form field definitions. Non-draft
        # submissions must run even with empty/absent custom_fields so
        # missing required fields are reported.
        if validate_custom_fields and (app_data.custom_fields or not is_draft):
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session,
                app_data.popup_id,
                app_data.custom_fields or {},
                skip_required=is_draft,
                is_express_checkout=is_express_checkout,
                # The same flow this application will be stamped with, so it
                # is judged against the form it was shown and not against
                # every flow's questions at once.
                sales_flow_id=self.resolve_target_flow_id(
                    session,
                    app_data.popup_id,
                    getattr(app_data, "sales_flow_id", None),
                ),
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Get human
        human = humans_crud.get(session, human_id)
        if not human:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Human not found",
            )

        # Validate required base fields against BaseFieldConfigs
        if validate_custom_fields and not is_draft:
            is_valid, errors = form_fields_crud.validate_base_fields(
                session,
                app_data.popup_id,
                app_data.model_dump(),
                human,
                is_express_checkout=is_express_checkout,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid base fields", "errors": errors},
                )

        # Step 3 of REQ-GR-003: recipient_email match (case-insensitive).
        # Deferred here so we have human.email available. Open invites (no
        # recipient_email) skip this check entirely.
        if _invite and _invite.recipient_email is not None:
            if _invite.recipient_email.lower() != human.email.lower():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This invite is restricted to a different email address",
                )

        # Validate group whitelist if group_id provided.
        # Reuses _group already fetched above (avoid duplicate DB hit).
        if _group_id:
            if not _group:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Group not found",
                )

            # Check if group belongs to same popup
            if _group.popup_id != app_data.popup_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Group does not belong to this popup",
                )

            # Check whitelist (skip if group is open - has no whitelisted emails)
            if not _group.is_open and not _group.has_whitelisted_email(human.email):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your email is not whitelisted for this group",
                )

        # Update human profile with any provided profile fields
        profile_fields = [
            "first_name",
            "last_name",
            "telegram",
            "gender",
            "age",
            "residence",
        ]
        profile_update = {}
        for field in profile_fields:
            value = getattr(app_data, field, None)
            if value is not None:
                profile_update[field] = value

        if profile_update:
            humans_crud.update(session, human, HumanUpdate(**profile_update))

        # Build application data (only application-specific fields)
        app_fields = [
            "popup_id",
            "referral",
            "info_not_shared",
            "custom_fields",
            "status",
            "group_id",
            # Attribution columns — groups-rework T-gr-032
            "invite_id",
            "referral_id",
            # Scholarship human-submittable fields (Phase 2.2)
            "scholarship_request",
            "scholarship_details",
            "scholarship_video_url",
        ]
        data = {
            k: v
            for k, v in app_data.model_dump().items()
            if k in app_fields and v is not None
        }
        data["tenant_id"] = tenant_id
        data["human_id"] = human_id
        # Stamp the target flow on every new application — an explicit
        # `sales_flow_id` (e.g. from the portal FlowPicker) when given, else
        # the popup's default flow. Never absent (F4).
        requested_flow_id = getattr(app_data, "sales_flow_id", None)
        data["sales_flow_id"] = self.resolve_target_flow_id(
            session, app_data.popup_id, requested_flow_id
        )

        # A group decides the flow for the people who join through it
        # (sdd/sales-flows-rediseno). A request naming a different one is a
        # disagreement about where this person belongs, and answering it by
        # picking a side silently is how the group's own form and emails
        # stopped reaching anybody in the first place.
        if _group is not None:
            if (
                requested_flow_id is not None
                and requested_flow_id != _group.sales_flow_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "This group applies through a different sales flow. "
                        "Leave the flow out to use the group's own."
                    ),
                )
            data["sales_flow_id"] = _group.sales_flow_id
        data["scholarship_status"] = _scholarship_status_for_request(
            bool(data.get("scholarship_request", False))
        )

        # _referral was resolved and validated above, next to group and invite
        # (T-gr-032: referral attribution wiring, groups-rework Decision 1f).
        # Its current_uses is incremented further down, on commit.

        # Auto-accept only when the group explicitly enables it via the
        # auto_approve_applications flag, or when the referral/invite enables it.
        # Previously this triggered for any application with a group_id (implicit);
        # now the flag must be True. Design Decision 1f: NO retroactive changes.
        should_auto_accept = bool(
            (_group and _group.auto_approve_applications)
            or (_referral and _referral.auto_approve)
            or (_invite and _invite.auto_approve)
        )
        if should_auto_accept:
            if human.red_flag:
                data["status"] = ApplicationStatus.REJECTED.value
            else:
                data["status"] = ApplicationStatus.ACCEPTED.value
                data["accepted_at"] = datetime.now(UTC)

        # Set submitted_at if status is IN_REVIEW or ACCEPTED
        if app_data.status in [
            ApplicationStatus.IN_REVIEW.value,
            ApplicationStatus.ACCEPTED.value,
            "in review",
            "accepted",
        ]:
            data["submitted_at"] = datetime.now(UTC)

        # Convert status enum to string if needed
        if data.get("status") and hasattr(data["status"], "value"):
            data["status"] = data["status"].value

        # Capture the custom fields schema at submission time
        data["custom_fields_schema"] = form_fields_crud.build_schema_for_flow(
            session, app_data.popup_id, data["sales_flow_id"]
        )

        application = Applications(**data)
        session.add(application)
        session.flush()

        # A referral whose auto-approval was revoked must remain in review.
        # Falling through to the popup's AUTO_ACCEPT strategy would grant the
        # referred attendee purchase access despite the link policy.
        if (
            _referral is not None
            and application.status == ApplicationStatus.IN_REVIEW.value
        ):
            self.create_snapshot(session, application, "submitted")

        # Apply the popup approval strategy for other non-group applications
        # still in review.
        if (
            not data.get("group_id")
            and _referral is None
            and application.status == ApplicationStatus.IN_REVIEW.value
        ):
            # Intercept: if the flow applied through charges a fee, gate on
            # PENDING_FEE.
            if config_for(
                session,
                sales_flow_id=application.sales_flow_id,
                popup_id=application.popup_id,
            ).requires_application_fee:
                application.status = ApplicationStatus.PENDING_FEE.value
                self.create_snapshot(session, application, "pending_fee")
            else:
                self._apply_approval_strategy(session, application, human)

        # Create snapshot for group auto-accept/reject
        if data.get("group_id"):
            event = (
                "auto_rejected"
                if application.status == ApplicationStatus.REJECTED.value
                else "auto_accepted"
            )
            self.create_snapshot(session, application, event)

        # Create snapshot for invite auto-accept/reject (mirrors group snapshot).
        # No group membership is added — invite flow is purchase-only.
        if _invite is not None and should_auto_accept:
            event = (
                "auto_rejected"
                if application.status == ApplicationStatus.REJECTED.value
                else "auto_accepted"
            )
            self.create_snapshot(session, application, event)

        # Sync membership junction: Application.group_id records origin (historical),
        # GroupMembers records currently-active membership. Keep them aligned on creation
        # so max_members validation and is_member() reflect the new application.
        if data.get("group_id") and not human.red_flag:
            from app.api.group.models import GroupMembers  # noqa: PLC0415

            existing_member = session.exec(
                select(GroupMembers).where(
                    GroupMembers.group_id == data["group_id"],
                    GroupMembers.human_id == human_id,
                )
            ).first()
            if not existing_member:
                session.add(
                    GroupMembers(
                        tenant_id=tenant_id,
                        group_id=data["group_id"],
                        human_id=human_id,
                    )
                )

        # Increment referral current_uses now that the application is being committed.
        # T-gr-032: referral attribution — spec REQ-GR-009.
        if _referral is not None:
            _referral.current_uses += 1
            session.add(_referral)

        # Apply invite discount and increment uses (REQ-GR-004).
        # Membership side-effect is GROUP-only — invite NEVER adds to group_members.
        # Inline the uses increment (mirror referral pattern) so all writes
        # commit in a single transaction boundary via the session.commit() below.
        if _invite is not None:
            _invite.current_uses += 1
            if _invite.used_at is None:
                _invite.used_at = datetime.now(UTC)
            if _invite.max_uses == 1:
                _invite.redeemed_by_human_id = human_id
            session.add(_invite)

        session.commit()
        session.refresh(application)
        return application

    def create_admin(
        self,
        session: Session,
        app_data: ApplicationAdminCreate,
        tenant_id: uuid.UUID,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Create an application as admin.

        This will find or create a Human record based on email,
        then create the application with the specified status.
        """

        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud
        from app.api.popup.crud import popups_crud

        # Get popup for check-in code prefix
        popup = popups_crud.get(session, app_data.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # Drafts are partial saves: skip "required field is missing" checks but
        # still validate types/constraints on any values the user did provide.
        is_draft = _is_draft_status(getattr(app_data, "status", None))

        # Resolve group to read its explicit express_checkout flag.
        # The presence of group_id alone MUST NOT trigger express checkout
        # (REQ-GR-014). Mirror the portal path (create_internal ~line 436).
        _admin_group_id = getattr(app_data, "group_id", None)
        _admin_group = None
        if _admin_group_id:
            from app.api.group.crud import groups_crud as _groups_crud

            _admin_group = _groups_crud.get(session, _admin_group_id)
        is_express_checkout = bool(_admin_group and _admin_group.express_checkout)

        # Validate custom_fields against form field definitions. Non-draft
        # submissions must run even with empty/absent custom_fields so
        # missing required fields are reported.
        if validate_custom_fields and (app_data.custom_fields or not is_draft):
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session,
                app_data.popup_id,
                app_data.custom_fields or {},
                skip_required=is_draft,
                is_express_checkout=is_express_checkout,
                # The same flow this application will be stamped with, so it
                # is judged against the form it was shown and not against
                # every flow's questions at once.
                sales_flow_id=self.resolve_target_flow_id(
                    session,
                    app_data.popup_id,
                    getattr(app_data, "sales_flow_id", None),
                ),
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Find or create human by email
        human = humans_crud.get_by_email(session, app_data.email)
        if not human:
            if not app_data.first_name or not app_data.last_name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Human with email '{app_data.email}' not found. "
                    "first_name and last_name are required to create a new human record.",
                )
            # Create new human
            human = humans_crud.create_internal(
                session,
                human_data=HumanCreate(
                    email=app_data.email,
                    first_name=app_data.first_name,
                    last_name=app_data.last_name,
                    telegram=app_data.telegram,
                    gender=app_data.gender,
                    age=app_data.age,
                    residence=app_data.residence,
                ),
                tenant_id=tenant_id,
            )

        # Validate required base fields against BaseFieldConfigs
        if validate_custom_fields and not is_draft:
            is_valid, errors = form_fields_crud.validate_base_fields(
                session,
                app_data.popup_id,
                app_data.model_dump(),
                human,
                is_express_checkout=is_express_checkout,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid base fields", "errors": errors},
                )
        else:
            # Update existing human profile
            profile_fields = [
                "first_name",
                "last_name",
                "telegram",
                "gender",
                "age",
                "residence",
            ]
            profile_update = {}
            for field in profile_fields:
                value = getattr(app_data, field, None)
                if value is not None:
                    profile_update[field] = value

            if profile_update:
                humans_crud.update(session, human, HumanUpdate(**profile_update))

        # Check for existing application, scoped to the flow this one
        # lands in. Honors an explicit sales_flow_id from the backoffice,
        # 404 if it does not belong to this popup or is not an application
        # flow. A group overrides it for the same reason as the portal
        # path: the group decides where the people who join it belong.
        flow_id = self.resolve_target_flow_id(
            session, app_data.popup_id, app_data.sales_flow_id
        )
        if _admin_group is not None:
            if (
                app_data.sales_flow_id is not None
                and app_data.sales_flow_id != _admin_group.sales_flow_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "This group applies through a different sales flow. "
                        "Leave the flow out to use the group's own."
                    ),
                )
            flow_id = _admin_group.sales_flow_id
        existing = self.get_by_human_flow(
            session, human_id=human.id, sales_flow_id=flow_id
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An application already exists for this human and sales flow",
            )

        # An application brings its own primary attendee, and this person
        # already has a row on somebody else's. Two rows is two QR codes for
        # one body at the door. Mirrors the guard the portal applies to the
        # same move in create_my_application.
        companion = attendees_crud.find_companion_for_popup(
            session, human_id=human.id, popup_id=app_data.popup_id
        )
        if companion:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This person is already attending this event as a companion "
                    "on another application."
                ),
            )

        # Build application data
        app_fields = [
            "popup_id",
            "referral",
            "info_not_shared",
            "custom_fields",
            "status",
            "group_id",
            # Scholarship human-submittable fields
            "scholarship_request",
            "scholarship_details",
            "scholarship_video_url",
        ]
        data = {
            k: v
            for k, v in app_data.model_dump().items()
            if k in app_fields and v is not None
        }
        data["tenant_id"] = tenant_id
        data["human_id"] = human.id
        data["sales_flow_id"] = flow_id
        data["scholarship_status"] = _scholarship_status_for_request(
            bool(data.get("scholarship_request", False))
        )

        # Convert status enum to string
        if data.get("status") and hasattr(data["status"], "value"):
            data["status"] = data["status"].value

        # Always set submitted_at on creation
        data["submitted_at"] = datetime.now(UTC)

        # Set accepted_at if status is accepted
        if data.get("status") in [ApplicationStatus.ACCEPTED.value, "accepted"]:
            data["accepted_at"] = datetime.now(UTC)

        # Capture the custom fields schema at submission time
        data["custom_fields_schema"] = form_fields_crud.build_schema_for_flow(
            session, app_data.popup_id, flow_id
        )

        application = Applications(**data)
        session.add(application)
        session.flush()

        # Apply approval strategy if status is IN_REVIEW
        if application.status == ApplicationStatus.IN_REVIEW.value:
            self._apply_approval_strategy(session, application, human)

        session.commit()
        session.refresh(application)
        return application

    def _apply_approval_strategy(
        self,
        session: Session,
        application: "Applications",
        human: "Humans",
    ) -> None:
        """Apply approval strategy to determine final status.

        - Red-flagged humans → REJECTED
        - No strategy or AUTO_ACCEPT → ACCEPTED
        - Other strategies → IN_REVIEW (unchanged)
        """

        from app.api.approval_strategy.crud import approval_strategies_crud
        from app.api.approval_strategy.schemas import ApprovalStrategyType

        # Red-flagged humans are automatically rejected
        if human.red_flag:
            application.status = ApplicationStatus.REJECTED.value
            self.create_snapshot(session, application, "auto_rejected")
            return

        # The strategy of the application's own flow (slice 6).
        strategy = approval_strategies_crud.get_by_flow(
            session, application.sales_flow_id
        )
        should_auto_accept = (
            strategy is None
            or strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT
        )

        if should_auto_accept:
            # Scholarship gate: if scholarship is requested and not yet decided,
            # hold the application in IN_REVIEW instead of auto-accepting.
            # Condition uses `not in (APPROVED, REJECTED)` to catch both None and "pending".
            from app.api.application.schemas import ScholarshipStatus

            if (
                application.scholarship_request
                and application.scholarship_status
                not in (
                    ScholarshipStatus.APPROVED.value,
                    ScholarshipStatus.REJECTED.value,
                )
            ):
                self.create_snapshot(session, application, "submitted")
                return
            application.status = ApplicationStatus.ACCEPTED.value
            application.accepted_at = datetime.now(UTC)
            self.create_snapshot(session, application, "auto_accepted")
            _maybe_grant_fee_credit(session, application)
        else:
            self.create_snapshot(session, application, "submitted")

    def validate_portal_update(
        self,
        session: Session,
        application: Applications,
        update_data: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Validate a portal application update against the popup's form.

        The portal sends the full form state on every save and omits
        cleared/empty answers, so an incoming ``custom_fields`` dict replaces
        the stored answers for every field the current form renders: a
        schema-known key absent from the payload means "cleared". Stored keys
        the form does not render (deleted, renamed, or hidden fields, or
        fields outside the Express Checkout mini-form) are preserved so old
        answers stay interpretable.

        When the update results in a non-draft status (submitting, or editing
        an already-submitted application), that resolved state must satisfy
        the same required and type checks the create path enforces. Draft
        saves skip required checks but still type-check the resolved values.

        ``update_data`` must contain only the keys the caller explicitly sent
        (``model_dump(exclude_unset=True)``).

        Returns the resolved ``custom_fields`` the caller must store, or
        ``None`` when the payload does not update them.
        """

        from app.api.form_field.crud import form_fields_crud

        incoming_status = update_data.get("status")
        if incoming_status is not None:
            incoming_status = getattr(incoming_status, "value", incoming_status)
        resulting_status = incoming_status or application.status
        is_draft = _is_draft_status(resulting_status)

        # Applications that entered through a group, invite or referral link
        # were filled with the Express Checkout reduced form; keep the same
        # relaxed required subset for their updates. Mirrors the entry-flow
        # rule in create_internal -- invite and referral were missing here, so
        # re-submitting such an application demanded fields it never rendered.
        is_express_checkout = bool(
            update_data.get("group_id")
            or application.group_id
            or application.invite_id
            or application.referral_id
        )

        stored_custom: dict[str, Any] = application.custom_fields or {}
        incoming_custom = update_data.get("custom_fields")
        resolved_custom: dict[str, Any] | None = None
        if incoming_custom is not None:
            rendered = form_fields_crud.get_portal_rendered_field_names(
                session,
                application.popup_id,
                is_express_checkout=is_express_checkout,
            )
            resolved_custom = {
                k: v for k, v in stored_custom.items() if k not in rendered
            } | incoming_custom

        # Validate exactly the state that will be stored. When custom_fields
        # isn't in the payload the stored answers stay untouched, but a
        # non-draft result must still satisfy required checks against them.
        if resolved_custom is not None:
            custom_fields = resolved_custom
        else:
            custom_fields = {} if is_draft else stored_custom

        is_valid, errors = form_fields_crud.validate_custom_fields(
            session,
            application.popup_id,
            custom_fields,
            skip_required=is_draft,
            is_express_checkout=is_express_checkout,
            sales_flow_id=application.sales_flow_id,
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"message": "Invalid custom fields", "errors": errors},
            )

        if is_draft:
            return resolved_custom

        # Base fields: stored application values overlaid with the incoming
        # payload; target=human fields fall back to the Human record inside
        # validate_base_fields.
        base_data: dict[str, Any] = {
            "referral": application.referral,
            "info_not_shared": application.info_not_shared,
            "scholarship_request": application.scholarship_request,
            "scholarship_details": application.scholarship_details,
            "scholarship_video_url": application.scholarship_video_url,
        }
        base_data.update({k: v for k, v in update_data.items() if v is not None})
        is_valid, errors = form_fields_crud.validate_base_fields(
            session,
            application.popup_id,
            base_data,
            application.human,
            is_express_checkout=is_express_checkout,
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"message": "Invalid base fields", "errors": errors},
            )

        return resolved_custom

    def update_with_profile(
        self,
        session: Session,
        application: Applications,
        update_data: ApplicationUpdate,
        validate_custom_fields: bool = True,
    ) -> Applications:
        """Update application and human profile.

        Profile fields in update_data are applied to the Human record.
        Application fields are applied to the Application record.
        """

        from app.api.form_field.crud import form_fields_crud
        from app.api.human.crud import humans_crud

        # Validate custom_fields if being updated
        if validate_custom_fields and update_data.custom_fields is not None:
            is_valid, errors = form_fields_crud.validate_custom_fields(
                session,
                application.popup_id,
                update_data.custom_fields,
                sales_flow_id=application.sales_flow_id,
            )
            if not is_valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"message": "Invalid custom fields", "errors": errors},
                )

        # Separate profile fields from application fields
        profile_fields = [
            "first_name",
            "last_name",
            "telegram",
            "gender",
            "age",
            "residence",
        ]
        app_fields = [
            "referral",
            "info_not_shared",
            "custom_fields",
            "status",
            "scholarship_request",
            "scholarship_details",
            "scholarship_video_url",
        ]

        # Update human profile
        profile_update = {}
        for field in profile_fields:
            value = getattr(update_data, field, None)
            if value is not None:
                profile_update[field] = value

        if profile_update and application.human:
            humans_crud.update(
                session, application.human, HumanUpdate(**profile_update)
            )

        # Update application
        app_update = {}
        for field in app_fields:
            value = getattr(update_data, field, None)
            if value is not None:
                app_update[field] = value

        if "scholarship_request" in app_update:
            app_update["scholarship_status"] = _scholarship_status_for_request(
                bool(app_update["scholarship_request"])
            )

        if app_update:
            for key, value in app_update.items():
                if hasattr(value, "value"):
                    value = value.value
                setattr(application, key, value)

        session.add(application)
        session.commit()
        session.refresh(application)
        return application

    def create_snapshot(
        self,
        session: Session,
        application: Applications,
        event: str,
    ) -> ApplicationSnapshots:
        """Create a snapshot of the application and human profile state.

        Uses flush (not commit) — the caller owns the transaction boundary.
        """

        snapshot = application.create_snapshot(event)
        session.add(snapshot)
        session.flush()
        return snapshot

    def promote_to_accepted(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Flush-only flip of an existing Application to ACCEPTED.

        Used by the admin bulk-grant endpoint when a Human already has an
        application for the popup but it is still in draft/in-review/etc.
        Sets `accepted_at`, writes an audit snapshot, and flushes — the
        caller owns the transaction so the entire grant batch stays atomic.

        Idempotent: a no-op when the application is already accepted.
        """

        if application.status == ApplicationStatus.ACCEPTED.value:
            return application

        application.status = ApplicationStatus.ACCEPTED.value
        application.accepted_at = datetime.now(UTC)
        session.add(application)
        self.create_snapshot(session, application, "admin_grant_accepted")
        _maybe_grant_fee_credit(session, application)
        return application

    def create_for_admin_grant(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        popup_id: uuid.UUID,
        human: "Humans",
    ) -> Applications:
        """Flush-only minimal Application + main Attendee for admin bulk grants.

        Skips custom_fields validation, approval strategy, group whitelisting,
        and the form-section fee gate — admin grants bypass user-facing checks
        because they are the staff-side equivalent of marking a ticket as comp.
        Status is hard-set to ACCEPTED and `accepted_at`/`submitted_at` are
        stamped to now.

        Caller owns the transaction boundary so a sold-out failure mid-batch
        rolls back every Human/Application/Attendee created in this run.
        """

        from app.api.attendee_category.crud import attendee_categories_crud
        from app.api.form_field.crud import form_fields_crud

        now = datetime.now(UTC)
        # sdd/sales-flows slice 5: stamp the popup's default flow, same as
        # every other application-creation path. The caller (grant_tickets_admin)
        # already confirmed no application exists for this human/popup via
        # get_by_human_popup before reaching here, so this never collides.
        flow_id = self.resolve_creation_flow_id(session, popup_id)
        application = Applications(
            tenant_id=tenant_id,
            popup_id=popup_id,
            human_id=human.id,
            sales_flow_id=flow_id,
            status=ApplicationStatus.ACCEPTED.value,
            submitted_at=now,
            accepted_at=now,
            custom_fields_schema=form_fields_crud.build_schema_for_flow(
                session, popup_id, flow_id
            ),
            # Granted (comped/gifted) people never filled the application
            # form, so they never consented to sharing anything: default the
            # attendee-directory privacy to fully hidden. They can opt in
            # later by editing their privacy preferences. Grants to people
            # with an EXISTING application keep whatever they chose.
            info_not_shared=list(GRANTED_DEFAULT_INFO_NOT_SHARED),
        )
        session.add(application)
        session.flush()

        main_cat = attendee_categories_crud.get_primary_for_popup(session, popup_id)
        name = (
            f"{human.first_name or ''} {human.last_name or ''}".strip() or human.email
        )
        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=popup_id,
            name=name,
            email=human.email,
            gender=human.gender,
            human_id=human.id,
            category_id=main_cat.id if main_cat else None,
        )
        session.add(attendee)
        self.create_snapshot(session, application, "admin_grant_created")
        session.flush()
        _maybe_grant_fee_credit(session, application)
        return application

    def accept(
        self,
        session: Session,
        application: Applications,
    ) -> Applications:
        """Accept an application and create snapshot.

        Raises:
            RedFlaggedHumanError: If the human is red-flagged and cannot be accepted.
        """

        # Red-flagged humans cannot be accepted
        human_red_flag = application.human.red_flag if application.human else False
        if human_red_flag:
            raise RedFlaggedHumanError(
                "Cannot accept application from a red-flagged human"
            )

        application.status = ApplicationStatus.ACCEPTED.value
        application.accepted_at = datetime.now(UTC)
        session.add(application)

        # Create snapshot — uses flush internally, caller owns the commit
        self.create_snapshot(session, application, "accepted")
        _maybe_grant_fee_credit(session, application)
        return application

    def create_attendee(
        self,
        session: Session,
        application: Applications,
        name: str,
        category_id: uuid.UUID | None = None,
        email: str | None = None,
        gender: str | None = None,
    ):
        """Add an attendee to an application.

        category_id (UUID FK) is required for any attendee beyond the primary.
        The legacy category string is no longer accepted — callers must resolve
        a category_id against the popup's attendee_categories table.
        """

        # Check for duplicate emails
        if email:
            existing_emails = [a.email for a in application.attendees if a.email]
            if email.lower() in existing_emails:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Attendee with this email already exists",
                )

            # The same guard the other add-a-companion route applies
            # (attendee/router.py). This one only looked inside the
            # application, so a person already at the gathering through any
            # other door came in a second time.
            existing_human_id = attendees_crud._find_human_id_by_email(
                session, email, application.tenant_id
            )
            if existing_human_id is not None and attendees_crud.human_attends_popup(
                session, existing_human_id, application.popup_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This person is already attending this event.",
                )

        attendee = attendees_crud.create_internal(
            session,
            tenant_id=application.tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            name=name,
            email=email.lower() if email else None,
            gender=gender,
            category_id=category_id,
        )

        session.refresh(application)
        return attendee

    def delete_attendee(
        self,
        session: Session,
        application: Applications,
        attendee_id: uuid.UUID,
    ) -> None:
        """Delete an attendee from an application."""

        attendee = next((a for a in application.attendees if a.id == attendee_id), None)
        if not attendee:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendee not found",
            )

        if attendee.category == "main":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete main attendee",
            )

        attendees_crud.delete_attendee(session, attendee)
        session.refresh(application)

    def review_scholarship(
        self,
        session: Session,
        application_id: uuid.UUID,
        decision: ScholarshipDecisionRequest,
    ) -> Applications:
        """Apply an admin scholarship decision to an application.

        Validates popup flags, updates scholarship fields, then re-runs
        the approval calculator so the application status reflects the
        scholarship outcome (e.g., AUTO_ACCEPT gate lifts → ACCEPTED).
        """
        from app.api.application.schemas import ScholarshipStatus
        from app.api.popup.crud import popups_crud
        from app.api.sales_flow.resolver import config_for  # noqa: PLC0415
        from app.services.approval.calculator import approval_calculator

        # 1. Fetch application
        application = self.get(session, application_id)
        if not application:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        # 2. Fetch popup
        popup = popups_crud.get(session, application.popup_id)
        if not popup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Popup not found",
            )

        # 3. Validate popup allows scholarship
        if not config_for(
            session,
            sales_flow_id=application.sales_flow_id,
            popup_id=application.popup_id,
        ).allows_scholarship:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Scholarship is not enabled for this popup",
            )

        # 4. Validate APPROVED-specific rules
        if decision.scholarship_status == ScholarshipStatus.APPROVED:
            if decision.discount_percentage is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="discount_percentage is required when approving a scholarship",
                )
            if (
                decision.incentive_amount is not None
                and not config_for(
                    session,
                    sales_flow_id=application.sales_flow_id,
                    popup_id=application.popup_id,
                ).allows_incentive
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Incentives are not enabled for this popup",
                )

        # 5. Update scholarship fields
        application.scholarship_status = decision.scholarship_status.value
        application.discount_percentage = decision.discount_percentage
        application.incentive_amount = decision.incentive_amount
        application.incentive_currency = decision.incentive_currency

        # 6. Persist scholarship decision
        session.add(application)
        session.flush()

        # 7. Re-evaluate application status (may lift AUTO_ACCEPT gate → ACCEPTED)
        # recalculate_status only commits internally when status actually changes.
        # If status doesn't change (e.g. application is already ACCEPTED, or strategy
        # keeps it IN_REVIEW), it returns without committing — the flush above is dangling.
        application = approval_calculator.recalculate_status(session, application)

        # Grant fee credit if the calculator reached ACCEPTED (flush-only;
        # the unconditional commit below persists it together with scholarship fields).
        _maybe_grant_fee_credit(session, application)

        # 8. Commit unconditionally: guarantees scholarship fields are persisted
        # regardless of whether recalculate_status committed or not.
        session.commit()
        session.refresh(application)

        return application

    def delete(self, session: Session, db_obj: Applications) -> None:
        """Delete an application, checking for payment history."""
        # Check if any attendees have payment history
        for attendee in db_obj.attendees:
            if attendee.payment_products:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Cannot delete application with payment history",
                )

        # Delete attendee products first
        for attendee in db_obj.attendees:
            for ap in attendee.attendee_products:
                session.delete(ap)

        session.delete(db_obj)
        session.commit()

    def resolve_popup_access(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> PopupAccessResponse:
        """Resolve positive grants before preserving Application denials."""
        from app.api.sales_flow.eligibility import has_popup_products

        application = self.get_by_human_popup(session, human_id, popup_id)

        if application is not None and (
            application.status == ApplicationStatus.ACCEPTED.value
        ):
            return PopupAccessResponse(
                allowed=True,
                source="application",
                application_status="accepted",
            )

        if has_popup_products(session, human_id, popup_id):
            return PopupAccessResponse(
                allowed=True,
                source="attendee",
            )

        if application is not None:
            app_status = application.status
            if app_status in (ApplicationStatus.IN_REVIEW.value, "submitted"):
                return PopupAccessResponse(
                    allowed=False,
                    application_status="in review"
                    if app_status == ApplicationStatus.IN_REVIEW.value
                    else "submitted",
                    reason="application_pending",
                )
            if app_status == ApplicationStatus.REJECTED.value:
                return PopupAccessResponse(
                    allowed=False,
                    application_status="rejected",
                    reason="application_rejected",
                )

        return PopupAccessResponse(
            allowed=False,
            reason="no_access",
        )

    def resolve_upsale_catalog(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> list["SalesFlows"]:
        """Flow-aware catalog resolution (sdd/sales-flows design G0 #2, D8,
        task 13.2). Returns every portal-listed, `type=upsale` sales flow of
        `popup_id` the human is currently eligible for.

        Eligibility (D8) is "any product assigned OR any APPROVED payment
        anywhere in the popup", evaluated live via `is_upsale_eligible` —
        the products leg is a product-owner amendment superseding G0 #3's
        payment-only wording so admin-granted attendee products qualify.
        An accepted but unpaid application STILL does not qualify unless
        products were granted. This is a listing, not an access gate: an
        ineligible or unknown human degrades to an empty catalog rather
        than raising, matching `find_portal_listed`'s own listing
        semantics elsewhere.

        Scope note: this resolves the ELIGIBLE UPSALE side of G0's "the
        catalog a person sees is their accepting flow's plus eligible
        upsale flows" only. The "accepting flow" half has no consumer yet
        (no shipped surface needs to know which flow a human's application
        belongs to alongside this list) — inventing that lookup here would
        be unused public surface (same precedent as slice 9's
        EffectiveFlowConfig scoping decision). Add it when a real consumer
        needs it.
        """
        from app.api.popup.models import Popups
        from app.api.sales_flow.crud import sales_flows_crud
        from app.api.sales_flow.eligibility import is_upsale_eligible
        from app.api.sales_flow.schemas import SalesFlowType
        from app.services.restrictions.context import build_context
        from app.services.restrictions.enforcement import restriction_passes

        if not is_upsale_eligible(session, human_id, popup_id):
            return []

        popup = session.get(Popups, popup_id)
        human = session.get(Humans, human_id)
        if popup is None or human is None:
            return []

        flows = sales_flows_crud.find_portal_listed(
            session, popup_id, type=SalesFlowType.upsale
        )
        return [
            flow
            for flow in flows
            if restriction_passes(
                flow, build_context(session, popup, flow, human=human)
            )
        ]

    def list_comments(
        self, session: Session, application_id: uuid.UUID
    ) -> list[ApplicationComment]:
        """Return an application's non-deleted comments, oldest first."""
        statement = (
            select(ApplicationComment)
            .where(
                ApplicationComment.application_id == application_id,
                col(ApplicationComment.deleted_at).is_(None),
            )
            .order_by(col(ApplicationComment.created_at).asc())
        )
        return list(session.exec(statement).all())

    def count_active_comments_by_applications(
        self, session: Session, application_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """Return a map of application_id -> non-deleted comment count.

        Single grouped query so callers listing many applications avoid N+1.
        """
        if not application_ids:
            return {}
        statement = (
            select(ApplicationComment.application_id, func.count())
            .where(
                col(ApplicationComment.application_id).in_(application_ids),
                col(ApplicationComment.deleted_at).is_(None),
            )
            .group_by(col(ApplicationComment.application_id))
        )
        return dict(session.exec(statement).all())

    def create_comment(
        self,
        session: Session,
        application: Applications,
        comment_in: ApplicationCommentCreate,
        author_user_id: uuid.UUID,
        author_name: str | None,
        author_email: str | None,
    ) -> ApplicationComment:
        """Add a comment to an application, snapshotting the author identity."""
        comment = ApplicationComment(
            tenant_id=application.tenant_id,
            application_id=application.id,
            author_user_id=author_user_id,
            author_name=author_name,
            author_email=author_email,
            body=comment_in.body,
        )
        session.add(comment)
        session.commit()
        session.refresh(comment)
        return comment

    def update_comment(
        self,
        session: Session,
        comment: ApplicationComment,
        comment_in: ApplicationCommentUpdate,
    ) -> ApplicationComment:
        """Edit a comment's body and stamp ``edited_at``."""
        comment.body = comment_in.body
        comment.edited_at = datetime.now(UTC)
        session.add(comment)
        session.commit()
        session.refresh(comment)
        return comment

    def soft_delete_comment(
        self, session: Session, comment: ApplicationComment
    ) -> None:
        """Soft-delete a comment: the row is preserved, hidden from reads."""
        comment.deleted_at = datetime.now(UTC)
        session.add(comment)
        session.commit()


def _maybe_grant_fee_credit(
    session: Session,
    application: "Applications",
) -> None:
    """Grant the application fee as portal credit on the first acceptance.

    Implements the fee → credit conversion (Spec R-BE-08, R-BE-09).
    No-op when:
    - Popup does not require an application fee.
    - The grant has already been issued (fee_credit_granted=True, idempotency guard).
    - The application's latest fee payment is not APPROVED.

    Flush-only — caller owns the commit boundary, keeping this atomic with
    the status transition that triggered it.
    """
    from app.api.audit_log.actor import actor_from_system
    from app.api.audit_log.constants import AuditAction
    from app.api.payment.crud import adjust_application_credit, payments_crud
    from app.api.payment.schemas import PaymentStatus
    from app.api.sales_flow.resolver import config_for  # noqa: PLC0415

    if application.status != ApplicationStatus.ACCEPTED.value:
        return

    if application.fee_credit_granted:
        return

    if not config_for(
        session,
        sales_flow_id=application.sales_flow_id,
        popup_id=application.popup_id,
    ).requires_application_fee:
        return

    fee_payment = payments_crud.get_latest_fee_payment(session, application.id)
    if fee_payment is None or fee_payment.status != PaymentStatus.APPROVED.value:
        return

    amount = Decimal(str(fee_payment.amount_charged or fee_payment.amount))

    adjust_application_credit(
        session,
        application,
        amount,
        kind=AuditAction.CREDIT_GRANTED,
        source="application_fee",
        actor=actor_from_system(),
        payment=fee_payment,
    )

    application.fee_credit_granted = True
    session.add(application)


applications_crud = ApplicationsCRUD()
