import uuid

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
    """CRUD for attendee categories."""

    def __init__(self) -> None:
        super().__init__(AttendeeCategories)

    def list_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[AttendeeCategories]:
        """Return categories for a popup ordered by sort_order, key."""
        statement = (
            select(AttendeeCategories)
            .where(AttendeeCategories.popup_id == popup_id)
            .order_by(AttendeeCategories.sort_order, AttendeeCategories.key)
        )
        return list(session.exec(statement).all())

    def create_for_popup(
        self,
        session: Session,
        data: AttendeeCategoryCreate,
        tenant_id: uuid.UUID,
    ) -> AttendeeCategories:
        """Create a new category for a popup.

        Raises 400 if key='main' is attempted (main is auto-seeded and immutable).
        Raises 409 if (popup_id, key) already exists (handled by IntegrityError in main.py).
        """
        if data.key == "main":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The 'main' category is managed automatically and cannot be created manually",
            )
        category = AttendeeCategories(
            tenant_id=tenant_id,
            popup_id=data.popup_id,
            key=data.key,
            is_primary=False,
            sort_order=data.sort_order,
            enabled_in_passes_flow=data.enabled_in_passes_flow,
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
        """Update a category.

        For primary (main) categories, only display_meta, required_fields,
        sort_order, and enabled_in_passes_flow may be changed.
        key and is_primary are never updatable via this method.
        """
        update_data = data.model_dump(exclude_unset=True)

        # These fields are never updatable
        for blocked in ("key", "is_primary"):
            if blocked in update_data:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Field '{blocked}' cannot be changed",
                )

        for field, value in update_data.items():
            setattr(category, field, value)

        session.add(category)
        session.commit()
        session.refresh(category)
        return category

    def delete_category(self, session: Session, category: AttendeeCategories) -> None:
        """Delete a category.

        Raises 400 if the category is the primary (main) one.
        """
        if category.is_primary:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The main category cannot be deleted",
            )
        session.delete(category)
        session.commit()

    def seed_main_for_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> AttendeeCategories:
        """Seed the main (primary) category for a new popup.

        Called inside the same transaction as popup creation.
        No commit here — caller controls the transaction.
        """
        existing = session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.popup_id == popup_id,
                AttendeeCategories.is_primary == sa.true(),
            )
        ).first()
        if existing:
            return existing

        category = AttendeeCategories(
            tenant_id=tenant_id,
            popup_id=popup_id,
            key="main",
            is_primary=True,
            sort_order=0,
            enabled_in_passes_flow=True,
            max_per_application=None,
            required_fields=[],
            display_meta={},
        )
        session.add(category)
        return category

    def exists_in_popup(
        self,
        session: Session,
        ids: list[uuid.UUID],
        popup_id: uuid.UUID,
    ) -> bool:
        """Return True if ALL ids belong to the given popup.

        Returns False if any id is not found or belongs to a different popup.
        """
        if not ids:
            return True
        statement = select(AttendeeCategories.id).where(
            AttendeeCategories.id.in_(ids),  # type: ignore[arg-type]
            AttendeeCategories.popup_id == popup_id,
        )
        found = set(session.exec(statement).all())
        return len(found) == len(set(ids))

    def get_primary_for_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> AttendeeCategories | None:
        """Return the primary (main) category for a popup, or None."""
        return session.exec(
            select(AttendeeCategories).where(
                AttendeeCategories.popup_id == popup_id,
                AttendeeCategories.is_primary == sa.true(),
            )
        ).first()


attendee_categories_crud = AttendeeCategoriesCRUD()
