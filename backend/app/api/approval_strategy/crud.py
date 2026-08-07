import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import (
    ApprovalStrategyCreate,
    ApprovalStrategyUpdate,
)
from app.api.shared.crud import BaseCRUD


class ApprovalStrategiesCRUD(
    BaseCRUD[ApprovalStrategies, ApprovalStrategyCreate, ApprovalStrategyUpdate]
):
    """CRUD operations for ApprovalStrategies."""

    def __init__(self) -> None:
        super().__init__(ApprovalStrategies)

    def get_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """The strategy of the popup's DEFAULT flow.

        Kept for callers that name a popup and mean "its default flow"
        (sdd/sales-flows-rediseno slice 6). There is no popup-shared
        strategy any more: a strategy belongs to one flow, so two
        application flows can review their applicants differently.
        """
        from app.api.sales_flow.crud import sales_flows_crud

        default_flow = sales_flows_crud.get_default_flow(session, popup_id)
        if default_flow is None:
            return None
        return self.get_by_flow(session, default_flow.id)

    def get_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """The strategy of `flow_id` — the only way to read one. None means
        this flow has no strategy, never that it should borrow another's."""
        statement = select(ApprovalStrategies).where(
            ApprovalStrategies.sales_flow_id == flow_id
        )
        return session.exec(statement).first()

    def create_for_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        strategy_in: ApprovalStrategyCreate,
        sales_flow_id: uuid.UUID | None = None,
    ) -> ApprovalStrategies:
        """Create a strategy for a flow. Omitting `sales_flow_id` means the
        popup's default flow, the one every popup has."""
        if sales_flow_id is None:
            from app.api.sales_flow.crud import sales_flows_crud

            default_flow = sales_flows_crud.get_default_flow(session, popup_id)
            if default_flow is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Popup has no default sales flow",
                )
            sales_flow_id = default_flow.id

        db_obj = ApprovalStrategies(
            popup_id=popup_id,
            tenant_id=tenant_id,
            sales_flow_id=sales_flow_id,
            **strategy_in.model_dump(),
        )
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def update(
        self,
        session: Session,
        db_obj: ApprovalStrategies,
        obj_in: ApprovalStrategyUpdate,
    ) -> ApprovalStrategies:
        """Update approval strategy."""
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)

        db_obj.updated_at = datetime.now(UTC)

        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj


approval_strategies_crud = ApprovalStrategiesCRUD()
