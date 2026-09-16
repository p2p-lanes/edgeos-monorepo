import copy
import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.attendee_category.models import AttendeeCategories
from app.api.attendee_category.schemas import (
    AttendeeCategoryCreate,
    AttendeeCategoryUpdate,
)
from app.api.shared.crud import BaseCRUD


class AttendeeCategoriesCRUD(
    BaseCRUD[AttendeeCategories, AttendeeCategoryCreate, AttendeeCategoryUpdate]
):
    """CRUD for sales-flow-owned attendee categories."""

    def __init__(self) -> None:
        super().__init__(AttendeeCategories)

    def get(self, session: Session, id: uuid.UUID) -> AttendeeCategories | None:
        """Return an active category by id."""
        return session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.id == id,
                AttendeeCategories.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()

    def list_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[AttendeeCategories]:
        """Return active categories for compatibility popup-level readers."""
        statement = (
            select(AttendeeCategories)
            .where(
                AttendeeCategories.popup_id == popup_id,
                AttendeeCategories.deleted_at.is_(None),  # type: ignore[union-attr]
            )
            .order_by(
                AttendeeCategories.sales_flow_id,
                AttendeeCategories.sort_order,
                AttendeeCategories.key,
            )
        )
        return list(session.exec(statement).all())

    def create_for_flow(
        self,
        session: Session,
        data: AttendeeCategoryCreate,
        flow,
    ) -> AttendeeCategories:
        """Create or restore a non-primary category owned only by ``flow``."""
        if data.popup_id != flow.popup_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Category popup must match the sales flow popup",
            )
        if data.key == "main":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The 'main' category is managed automatically and cannot be created manually",
            )

        category = session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.sales_flow_id == flow.id,
                AttendeeCategories.key == data.key,
            )
        ).first()
        if category is not None:
            if category.deleted_at is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A category with this key already exists in the sales flow",
                )
            category.deleted_at = None
            category.sort_order = data.sort_order
            category.max_per_application = data.max_per_application
            category.required_fields = data.required_fields
            category.display_meta = data.display_meta
        else:
            category = AttendeeCategories(
                tenant_id=flow.tenant_id,
                popup_id=flow.popup_id,
                sales_flow_id=flow.id,
                key=data.key,
                is_primary=False,
                sort_order=data.sort_order,
                max_per_application=data.max_per_application,
                required_fields=data.required_fields,
                display_meta=data.display_meta,
            )

        session.add(category)
        session.commit()
        session.refresh(category)
        return category

    def update_category(
        self,
        session: Session,
        category: AttendeeCategories,
        data: AttendeeCategoryUpdate,
    ) -> AttendeeCategories:
        """Update mutable configuration on one flow's category."""
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(category, field, value)

        session.add(category)
        session.commit()
        session.refresh(category)
        return category

    def delete_category(self, session: Session, category: AttendeeCategories) -> None:
        """Soft-delete a non-primary category and remove live step references."""
        if category.is_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The main category cannot be deleted",
            )

        self._remove_from_ticketing_steps(session, category)
        category.deleted_at = datetime.now(UTC)
        session.add(category)
        session.commit()

    def _remove_from_ticketing_steps(
        self, session: Session, category: AttendeeCategories
    ) -> None:
        """Remove a deleted category UUID from ticket-select sections in its flow."""
        from app.api.ticketing_step.models import TicketingSteps  # noqa: PLC0415

        steps = session.exec(
            select(TicketingSteps).where(
                TicketingSteps.sales_flow_id == category.sales_flow_id,
                TicketingSteps.template == "ticket-select",
            )
        ).all()
        category_id = str(category.id)
        for step in steps:
            if not isinstance(step.template_config, dict):
                continue
            config = copy.deepcopy(step.template_config)
            changed = False
            for section in config.get("sections") or []:
                if not isinstance(section, dict):
                    continue
                category_ids = section.get("attendee_categories")
                if not isinstance(category_ids, list):
                    continue
                filtered = [
                    value for value in category_ids if str(value) != category_id
                ]
                if filtered != category_ids:
                    section["attendee_categories"] = filtered
                    changed = True
            if changed:
                step.template_config = config
                session.add(step)

    def seed_main_for_flow(self, session: Session, flow) -> AttendeeCategories:
        """Ensure one active primary category exists for a flow without committing."""
        existing = session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.sales_flow_id == flow.id,
                AttendeeCategories.is_primary == sa.true(),
            )
        ).first()
        if existing is not None:
            if existing.deleted_at is not None:
                existing.deleted_at = None
                session.add(existing)
            return existing

        category = AttendeeCategories(
            tenant_id=flow.tenant_id,
            popup_id=flow.popup_id,
            sales_flow_id=flow.id,
            key="main",
            is_primary=True,
            sort_order=0,
            max_per_application=None,
            required_fields=[],
            display_meta={},
        )
        session.add(category)
        return category

    def get_primary_for_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> AttendeeCategories | None:
        """Return the active primary category owned by a flow."""
        return session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.sales_flow_id == flow_id,
                AttendeeCategories.is_primary == sa.true(),
                AttendeeCategories.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()

    def get_primary_for_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> AttendeeCategories | None:
        """Compatibility lookup through the popup's deterministic default flow."""
        from app.api.sales_flow.crud import sales_flows_crud  # noqa: PLC0415

        flow = sales_flows_crud.get_default_flow(session, popup_id)
        return self.get_primary_for_flow(session, flow.id) if flow is not None else None

    def list_by_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> list[AttendeeCategories]:
        """Return active category definitions owned by one flow."""
        statement = (
            select(AttendeeCategories)
            .where(
                AttendeeCategories.sales_flow_id == flow_id,
                AttendeeCategories.deleted_at.is_(None),  # type: ignore[union-attr]
            )
            .order_by(AttendeeCategories.sort_order, AttendeeCategories.key)
        )
        return list(session.exec(statement).all())

    def allowed_ids_for_flow(
        self, session: Session, flow_id: uuid.UUID
    ) -> set[uuid.UUID]:
        """Return active category ids owned by one flow."""
        return set(
            session.exec(
                select(AttendeeCategories.id).where(
                    AttendeeCategories.sales_flow_id == flow_id,
                    AttendeeCategories.deleted_at.is_(None),  # type: ignore[union-attr]
                )
            ).all()
        )

    def seed_for_flow(
        self,
        session: Session,
        flow,
        *,
        source_flow_id: uuid.UUID | None = None,
    ) -> None:
        """Seed an independent main or clone all active source definitions."""
        source_categories = (
            self.list_by_flow(session, source_flow_id)
            if source_flow_id is not None
            else []
        )
        if not source_categories:
            self.seed_main_for_flow(session, flow)
            return

        clones = [
            AttendeeCategories(
                tenant_id=flow.tenant_id,
                popup_id=flow.popup_id,
                sales_flow_id=flow.id,
                key=category.key,
                is_primary=category.is_primary,
                sort_order=category.sort_order,
                max_per_application=category.max_per_application,
                required_fields=copy.deepcopy(category.required_fields),
                display_meta=copy.deepcopy(category.display_meta),
            )
            for category in source_categories
        ]
        session.add_all(clones)
        if not any(category.is_primary for category in clones):
            self.seed_main_for_flow(session, flow)


attendee_categories_crud = AttendeeCategoriesCRUD()
