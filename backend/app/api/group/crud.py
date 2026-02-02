import random
import string
import uuid

from fastapi import HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.group.schemas import GroupCreate, GroupUpdate
from app.api.shared.crud import BaseCRUD


def generate_random_slug(length: int = 4) -> str:
    """Generate a random lowercase string for slug."""
    return "".join(random.choices(string.ascii_lowercase, k=length))


class GroupsCRUD(BaseCRUD[Groups, GroupCreate, GroupUpdate]):
    """CRUD operations for Groups."""

    def __init__(self) -> None:
        super().__init__(Groups)

    def get_by_slug(
        self, session: Session, slug: str, popup_id: uuid.UUID | None = None
    ) -> Groups | None:
        """Get a group by slug, optionally filtering by popup_id."""
        statement = select(Groups).where(Groups.slug == slug)
        if popup_id:
            statement = statement.where(Groups.popup_id == popup_id)
        return session.exec(statement).first()

    def get_with_members(self, session: Session, group_id: uuid.UUID) -> Groups | None:
        """Get a group with eager loaded applications, attendees, and products.

        Use this when you need to access group.applications and their nested
        attendees/products to avoid N+1 queries.
        """
        from app.api.application.models import Applications
        from app.api.attendee.models import AttendeeProducts, Attendees

        statement = (
            select(Groups)
            .where(Groups.id == group_id)
            .options(
                selectinload(Groups.applications)  # type: ignore[arg-type]
                .selectinload(Applications.attendees)  # ty: ignore[invalid-argument-type]
                .selectinload(Attendees.attendee_products)  # ty: ignore[invalid-argument-type]
                .selectinload(AttendeeProducts.product),  # ty: ignore[invalid-argument-type]
                selectinload(Groups.applications).selectinload(  # type: ignore[arg-type]
                    Applications.human  # ty: ignore[invalid-argument-type]
                ),
            )
        )
        return session.exec(statement).first()

    def find_by_leader(
        self,
        session: Session,
        human_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Groups], int]:
        """Find groups where human is a leader."""
        statement = (
            select(Groups)
            .join(GroupLeaders, GroupLeaders.group_id == Groups.id)  # type: ignore[arg-type]
            .where(GroupLeaders.human_id == human_id)
        )

        # Get total count
        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        # Apply pagination and ordering
        statement = statement.order_by(desc(Groups.created_at))  # type: ignore[arg-type]
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Groups], int]:
        """Find groups by popup_id."""
        statement = select(Groups).where(Groups.popup_id == popup_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.order_by(desc(Groups.created_at))  # type: ignore[arg-type]
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def validate_member_addition(
        self,
        group: Groups,
        human_id: uuid.UUID,
        update_existing: bool = False,
    ) -> None:
        """
        Validate if a human can be added to a group.

        Raises:
            HTTPException: If validation fails.
        """
        members_ids = [member.id for member in group.members]

        if human_id in members_ids:
            if not update_existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Human is already a member of this group",
                )
            return

        if group.max_members is not None and len(group.members) >= group.max_members:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group has reached maximum members",
            )

    def add_leader(
        self, session: Session, group_id: uuid.UUID, human_id: uuid.UUID
    ) -> None:
        """Add a leader to a group."""
        leader = GroupLeaders(group_id=group_id, human_id=human_id)
        session.add(leader)
        session.commit()

    def remove_leader(
        self, session: Session, group_id: uuid.UUID, human_id: uuid.UUID
    ) -> None:
        """Remove a leader from a group."""
        statement = select(GroupLeaders).where(
            GroupLeaders.group_id == group_id, GroupLeaders.human_id == human_id
        )
        leader = session.exec(statement).first()
        if leader:
            session.delete(leader)
            session.commit()

    def add_member(
        self, session: Session, group_id: uuid.UUID, human_id: uuid.UUID
    ) -> None:
        """Add a member to a group."""
        member = GroupMembers(group_id=group_id, human_id=human_id)
        session.add(member)
        session.commit()

    def remove_member(
        self, session: Session, group_id: uuid.UUID, human_id: uuid.UUID
    ) -> None:
        """Remove a member from a group."""
        statement = select(GroupMembers).where(
            GroupMembers.group_id == group_id, GroupMembers.human_id == human_id
        )
        member = session.exec(statement).first()
        if member:
            session.delete(member)
            session.commit()

    def is_member(
        self, session: Session, group_id: uuid.UUID, human_id: uuid.UUID
    ) -> bool:
        """Check if a human is a member of a group."""
        statement = select(GroupMembers).where(
            GroupMembers.group_id == group_id, GroupMembers.human_id == human_id
        )
        return session.exec(statement).first() is not None

    def generate_unique_slug(
        self, session: Session, popup_id: uuid.UUID, prefix: str
    ) -> str:
        """Generate a unique slug for a group."""
        slug = f"{prefix}-{generate_random_slug()}"
        while self.get_by_slug(session, slug, popup_id):
            slug = f"{prefix}-{generate_random_slug()}"
        return slug


groups_crud = GroupsCRUD()
