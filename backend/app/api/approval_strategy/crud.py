import uuid
from datetime import UTC, datetime

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
        """Get the popup-shared approval strategy (`flow_id IS NULL`).

        This is the tier every flow inherits by default (sdd/sales-flows
        slice 7) and the exact strategy every popup had before this slice.
        """
        statement = select(ApprovalStrategies).where(
            ApprovalStrategies.popup_id == popup_id,
            ApprovalStrategies.flow_id.is_(None),  # type: ignore[union-attr]
        )
        return session.exec(statement).first()

    def get_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> ApprovalStrategies | None:
        """Strategy owned exclusively by `flow_id` (sdd/sales-flows slice 7).

        No write path creates one yet — the backoffice editor is slice 14.
        """
        statement = select(ApprovalStrategies).where(
            ApprovalStrategies.flow_id == flow_id
        )
        return session.exec(statement).first()

    def get_for_flow(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID | None,
    ) -> ApprovalStrategies | None:
        """Flow-owned strategy if `flow_id` owns one, else the popup-shared
        fallback (sdd/sales-flows slice 7). `flow_id=None` (e.g. a legacy
        application with no flow) always returns the popup-shared tier."""
        if flow_id is not None:
            flow_strategy = self.get_by_flow(session, flow_id)
            if flow_strategy:
                return flow_strategy
        return self.get_by_popup(session, popup_id)

    def create_for_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        strategy_in: ApprovalStrategyCreate,
    ) -> ApprovalStrategies:
        """Create approval strategy for a popup."""
        db_obj = ApprovalStrategies(
            popup_id=popup_id,
            tenant_id=tenant_id,
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
