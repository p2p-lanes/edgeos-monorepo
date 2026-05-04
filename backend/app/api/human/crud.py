import uuid

from loguru import logger
from sqlalchemy import exists, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.api.human.models import Humans
from app.api.human.schemas import HumanCreate, HumanUpdate
from app.api.shared.crud import BaseCRUD


class HumansCRUD(BaseCRUD[Humans, HumanCreate, HumanUpdate]):
    def __init__(self) -> None:
        super().__init__(Humans)

    def find_or_create(
        self,
        session: Session,
        email: str,
        tenant_id: uuid.UUID,
        *,
        default_first_name: str | None = None,
        default_last_name: str | None = None,
    ) -> Humans:
        """Return the existing Human for (email, tenant_id) or create one.

        NEVER overwrites fields on an existing row. Uses INSERT ... ON CONFLICT
        DO NOTHING pattern to handle concurrent callers safely — the unique
        constraint uq_human_email_tenant_id guarantees exactly one row.
        If the session does not support advisory INSERT/IGNORE, falls back to
        catching IntegrityError then SELECTing the existing row.
        """
        # Fast path: try to find existing row first (most callers hit this)
        existing = session.exec(
            select(Humans).where(
                Humans.email == email,
                Humans.tenant_id == tenant_id,
            )
        ).first()
        if existing is not None:
            return existing

        # Slow path: attempt INSERT; catch race on unique constraint
        new_human = Humans(
            id=uuid.uuid4(),
            email=email,
            tenant_id=tenant_id,
            first_name=default_first_name,
            last_name=default_last_name,
        )
        try:
            session.add(new_human)
            session.flush()
            session.refresh(new_human)
            session.commit()
            return new_human
        except IntegrityError:
            # Another concurrent caller won the race — roll back and fetch
            session.rollback()
            logger.info(
                "find_or_create: IntegrityError race on ({}, {}) — fetching existing row",
                email,
                tenant_id,
            )
            existing = session.exec(
                select(Humans).where(
                    Humans.email == email,
                    Humans.tenant_id == tenant_id,
                )
            ).first()
            if existing is None:
                raise RuntimeError(
                    f"find_or_create: could not find or create Human for ({email}, {tenant_id})"
                ) from None
            return existing

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
