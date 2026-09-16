import uuid

from loguru import logger
from sqlalchemy import or_
from sqlmodel import Session, col, func, select

from app.api.shared.crud import BaseCRUD
from app.api.shared.enums import UserRole
from app.api.user.models import Users
from app.api.user.schemas import UserCreate, UserUpdate
from app.core.dependencies.users import invalidate_user_cache
from app.core.redis import auth_code_store


class UsersCRUD(BaseCRUD[Users, UserCreate, UserUpdate]):
    def __init__(self) -> None:
        super().__init__(Users)

    def get_by_email(
        self, session: Session, email: str, include_deleted: bool = False
    ) -> Users | None:
        statement = select(Users).where(Users.email == email)
        if not include_deleted:
            statement = statement.where(Users.deleted == False)  # noqa: E712
        return session.exec(statement).first()

    def find_filtered(
        self,
        session: Session,
        tenant_id: uuid.UUID | None = None,
        role: UserRole | None = None,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        roles_in: list[UserRole] | None = None,
    ) -> tuple[list[Users], int]:
        """Find users with optional filters."""

        statement = select(Users).where(Users.deleted == False)  # noqa: E712

        if tenant_id is not None:
            statement = statement.where(Users.tenant_id == tenant_id)

        if role is not None:
            statement = statement.where(Users.role == role)

        if roles_in is not None:
            statement = statement.where(col(Users.role).in_(roles_in))

        # Apply text search if provided
        if search:
            search_term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(Users.full_name).ilike(search_term),
                    col(Users.email).ilike(search_term),
                )
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        results = list(session.exec(statement.offset(skip).limit(limit)).all())
        return results, total

    def authenticate(self, session: Session, email: str, password: str) -> Users | None:
        admin = self.get_by_email(session, email)

        if admin is None:
            logger.debug(f"Login attempt for non-existent email: {email}")
            return None

        if admin.deleted:
            logger.debug(f"Login attempt for deleted user: {email}")
            return None

        return admin

    def create(
        self,
        session: Session,
        obj_in: UserCreate,
    ) -> Users:
        admin = Users(
            email=obj_in.email,
            full_name=obj_in.full_name,
            role=obj_in.role,
            tenant_id=obj_in.tenant_id,
        )

        session.add(admin)
        session.commit()
        session.refresh(admin)

        return admin

    def update(
        self,
        session: Session,
        db_obj: Users,
        obj_in: UserUpdate,
    ) -> Users:
        update_data = obj_in.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            setattr(db_obj, field, value)

        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)

        # Invalidate cache so next request gets fresh data
        invalidate_user_cache(db_obj.id)

        return db_obj

    def mark_deleted(self, session: Session, db_obj: Users) -> None:
        """Stage a user soft-delete and immediately revoke cached authentication."""
        db_obj.deleted = True
        db_obj.auth_code = None
        db_obj.code_expiration = None
        db_obj.auth_attempts = 0
        session.add(db_obj)

        # Security state outside the transaction must be invalidated immediately.
        invalidate_user_cache(db_obj.id)

    def soft_delete_for_tenant(
        self, session: Session, tenant_id: uuid.UUID
    ) -> list[Users]:
        """Stage soft-deletion of every active user owned by a tenant.

        The caller owns the transaction so the users and tenant can be committed
        together.
        """
        users = list(
            session.exec(
                select(Users).where(
                    Users.tenant_id == tenant_id,
                    Users.deleted == False,  # noqa: E712
                )
            ).all()
        )
        for user in users:
            self.mark_deleted(session, user)
        auth_code_store.delete_user_codes(user.id for user in users)
        return users

    def soft_delete(self, session: Session, db_obj: Users) -> Users:
        self.mark_deleted(session, db_obj)
        auth_code_store.delete_user_code(db_obj.id)
        session.commit()
        session.refresh(db_obj)
        return db_obj


users_crud = UsersCRUD()
