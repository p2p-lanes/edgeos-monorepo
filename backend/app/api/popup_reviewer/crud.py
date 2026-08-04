import uuid

from sqlmodel import Session, func, select

from app.api.popup_reviewer.models import PopupReviewers
from app.api.popup_reviewer.schemas import (
    PopupReviewerCreate,
    PopupReviewerUpdate,
)
from app.api.shared.crud import BaseCRUD


class PopupReviewersCRUD(
    BaseCRUD[PopupReviewers, PopupReviewerCreate, PopupReviewerUpdate]
):
    """CRUD operations for PopupReviewers."""

    def __init__(self) -> None:
        super().__init__(PopupReviewers)

    def get_by_popup_user(
        self,
        session: Session,
        popup_id: uuid.UUID,
        user_id: uuid.UUID,
        flow_id: uuid.UUID | None = None,
    ) -> PopupReviewers | None:
        """Get reviewer at a specific tier (sdd/sales-flows D4).

        `flow_id=None` -> the popup-shared tier (`sales_flow_id IS NULL`);
        `flow_id=<uuid>` -> that flow's own tier.
        """
        statement = select(PopupReviewers).where(
            PopupReviewers.popup_id == popup_id,
            PopupReviewers.user_id == user_id,
        )
        if flow_id is not None:
            statement = statement.where(PopupReviewers.sales_flow_id == flow_id)
        else:
            statement = statement.where(PopupReviewers.sales_flow_id.is_(None))  # type: ignore[union-attr]
        return session.exec(statement).first()

    def resolve_for_flow(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID | None,
    ) -> list[PopupReviewers]:
        """Resolve the reviewer set for a flow per its tri-state
        `reviewers_mode` (design D4).

        `flow_id=None` (no flow context, e.g. a legacy application) always
        reads the popup-shared tier. Otherwise resolves through the flow's
        own `reviewers_mode`: 'inherit' reads the popup-shared tier;
        'override' reads ONLY that flow's own reviewer rows — zero rows is
        a valid answer (no reviewers), the popup tier never falls through
        once a flow overrides.
        """
        from app.api.sales_flow.crud import sales_flows_crud
        from app.api.sales_flow.schemas import SalesFlowReviewersMode

        if flow_id is not None:
            flow = sales_flows_crud.get(session, flow_id)
            if flow and flow.reviewers_mode == SalesFlowReviewersMode.override:
                statement = select(PopupReviewers).where(
                    PopupReviewers.sales_flow_id == flow_id
                )
                return list(session.exec(statement).all())

        statement = select(PopupReviewers).where(
            PopupReviewers.popup_id == popup_id,
            PopupReviewers.sales_flow_id.is_(None),  # type: ignore[union-attr]
        )
        return list(session.exec(statement).all())

    def has_flow_reviewers(self, session: Session, flow_id: uuid.UUID) -> bool:
        """Whether a flow has any of its own (flow-tier) reviewer rows.

        Used to validate `SalesFlows.reviewers_mode` transitions: 'override'
        requires at least one row here, 'inherit' requires zero.
        """
        count = session.exec(
            select(func.count())
            .select_from(PopupReviewers)
            .where(PopupReviewers.sales_flow_id == flow_id)
        ).one()
        return count > 0

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[PopupReviewers], int]:
        """Find all reviewers for a popup, regardless of `sales_flow_id`
        tier (admin/legacy surface, sdd/sales-flows slice 7 — see
        `resolve_for_flow` for the flow-aware read path)."""
        statement = select(PopupReviewers).where(PopupReviewers.popup_id == popup_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_popup_shared(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[PopupReviewers], int]:
        """Popup-shared tier only (`sales_flow_id IS NULL`), paginated — the
        exact reviewer list every popup had before sdd/sales-flows D4."""
        statement = select(PopupReviewers).where(
            PopupReviewers.popup_id == popup_id,
            PopupReviewers.sales_flow_id.is_(None),  # type: ignore[union-attr]
        )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_all_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
    ) -> list[PopupReviewers]:
        """Find all reviewers for a popup without pagination.

        Use this when you need all reviewers (e.g., for approval calculation).
        Reviewers are bounded by design (typically < 10 per popup).
        """
        statement = select(PopupReviewers).where(PopupReviewers.popup_id == popup_id)
        return list(session.exec(statement).all())

    def find_by_user(
        self,
        session: Session,
        user_id: uuid.UUID,
    ) -> list[PopupReviewers]:
        """Find all popups a user is assigned to review."""
        statement = select(PopupReviewers).where(PopupReviewers.user_id == user_id)
        return list(session.exec(statement).all())

    def create_reviewer(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        reviewer_in: PopupReviewerCreate,
    ) -> PopupReviewers:
        """Add a reviewer to a popup, or to one specific flow of that popup
        when `reviewer_in.sales_flow_id` is set (sdd/sales-flows D4). Adding
        a flow-tier reviewer switches that flow's `reviewers_mode` to
        'override' (CRUD invariant, enforced here — not in SQL)."""
        db_obj = PopupReviewers(
            popup_id=popup_id,
            tenant_id=tenant_id,
            sales_flow_id=reviewer_in.sales_flow_id,
            user_id=reviewer_in.user_id,
            is_required=reviewer_in.is_required,
            weight_multiplier=reviewer_in.weight_multiplier,
        )
        session.add(db_obj)
        session.flush()

        if reviewer_in.sales_flow_id is not None:
            from app.api.sales_flow.crud import sales_flows_crud

            sales_flows_crud.ensure_reviewers_override(
                session, reviewer_in.sales_flow_id, commit=False
            )

        session.commit()
        session.refresh(db_obj)
        return db_obj

    def delete_reviewer(self, session: Session, reviewer: PopupReviewers) -> None:
        """Delete a reviewer. If this was the last flow-tier reviewer for
        its flow, resets that flow's `reviewers_mode` back to 'inherit'
        (sdd/sales-flows D4 CRUD invariant — clearing the override falls
        back to the popup-shared tier). Row delete and mode flip commit
        together (rel-001: no window where one persists without the other)."""
        flow_id = reviewer.sales_flow_id
        session.delete(reviewer)
        session.flush()

        if flow_id is not None:
            remaining = session.exec(
                select(func.count())
                .select_from(PopupReviewers)
                .where(PopupReviewers.sales_flow_id == flow_id)
            ).one()
            if remaining == 0:
                from app.api.sales_flow.crud import sales_flows_crud

                sales_flows_crud.reset_reviewers_inherit(session, flow_id, commit=False)

        session.commit()


popup_reviewers_crud = PopupReviewersCRUD()
