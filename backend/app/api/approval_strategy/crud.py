import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import (
    ApprovalStrategyCreate,
    ApprovalStrategyType,
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
        """Return the explicitly configured gathering-level strategy."""
        statement = select(ApprovalStrategies).where(
            ApprovalStrategies.popup_id == popup_id,
            ApprovalStrategies.sales_flow_id.is_(None),  # type: ignore[union-attr]
        )
        return session.exec(statement).first()

    def get_effective_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """Return the gathering strategy, safely defaulting to AUTO_ACCEPT."""
        strategy = self.get_by_popup(session, popup_id)
        if strategy is not None:
            return strategy

        from app.api.popup.models import Popups

        popup = session.get(Popups, popup_id)
        if popup is None:
            return None
        return ApprovalStrategies(
            popup_id=popup.id,
            tenant_id=popup.tenant_id,
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
        )

    def get_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """Resolve approval policy only for an application flow."""
        from app.api.sales_flow.crud import sales_flows_crud
        from app.api.sales_flow.schemas import SalesFlowType

        flow = sales_flows_crud.get(session, flow_id)
        if flow is None or flow.type != SalesFlowType.application:
            return None

        strategy = self.get_override_by_flow(session, flow_id)
        if strategy is not None:
            return strategy
        return self.get_effective_by_popup(session, flow.popup_id)

    def get_override_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """Return only the strategy explicitly owned by one sales flow."""
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
        *,
        commit: bool = True,
    ) -> ApprovalStrategies:
        """Create a gathering default or an application-flow override.

        Flow ownership is validated only for overrides. A gathering default
        is valid regardless of the gathering's current sales-flow mix.
        """
        if sales_flow_id is not None:
            from app.api.sales_flow.crud import sales_flows_crud
            from app.api.sales_flow.schemas import SalesFlowType

            flow = sales_flows_crud.get(session, sales_flow_id)
            if flow is None or flow.popup_id != popup_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Sales flow not found for this popup",
                )

            if flow.type != SalesFlowType.application:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Only application flows can have an approval strategy. "
                        f"This flow sells directly ({flow.type})."
                    ),
                )

        db_obj = ApprovalStrategies(
            popup_id=popup_id,
            tenant_id=tenant_id,
            sales_flow_id=sales_flow_id,
            **strategy_in.model_dump(),
        )
        session.add(db_obj)
        if commit:
            session.commit()
            session.refresh(db_obj)
        else:
            session.flush()
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
