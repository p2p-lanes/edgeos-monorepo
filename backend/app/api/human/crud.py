import uuid

from sqlalchemy import exists, or_
from sqlmodel import Session, col, func, select

from app.api.human.models import Humans
from app.api.human.schemas import HumanCreate, HumanUpdate
from app.api.shared.crud import BaseCRUD


class HumansCRUD(BaseCRUD[Humans, HumanCreate, HumanUpdate]):
    def __init__(self) -> None:
        super().__init__(Humans)

    def get_by_email(
        self, session: Session, email: str, tenant_id: uuid.UUID | None = None
    ) -> Humans | None:
        statement = select(Humans).where(Humans.email == email)
        if tenant_id:
            statement = statement.where(Humans.tenant_id == tenant_id)
        return session.exec(statement).first()

    def create_internal(
        self, session: Session, human_data: HumanCreate, tenant_id: uuid.UUID
    ) -> Humans:
        """Create a human with explicit tenant_id (for admin-created humans)."""
        db_obj = Humans(**human_data.model_dump(), tenant_id=tenant_id)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def find_with_incomplete_application(
        self,
        session: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        popup_id: uuid.UUID | None = None,
    ) -> tuple[list[Humans], int]:
        """Find humans with at least one draft application.

        If popup_id is provided, only draft applications for that popup are considered.
        """
        from app.api.application.models import Applications

        has_draft_application = exists().where(
            Applications.human_id == Humans.id,
            Applications.status == "draft",
        )

        if popup_id:
            has_draft_application = has_draft_application.where(
                Applications.popup_id == popup_id
            )

        statement = select(Humans).where(has_draft_application)

        if search:
            search_term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                )
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        results = list(session.exec(statement.offset(skip).limit(limit)).all())
        return results, total


humans_crud = HumansCRUD()
