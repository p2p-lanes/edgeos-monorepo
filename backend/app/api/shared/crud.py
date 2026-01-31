import uuid
from typing import Any

from pydantic import BaseModel
from sqlmodel import Session, SQLModel, func, select


class BaseCRUD[
    ModelType: SQLModel,
    CreateSchemaType: BaseModel,
    UpdateSchemaType: BaseModel,
]:
    def __init__(self, model: type[ModelType]) -> None:
        self.model = model

    def get(self, session: Session, id: uuid.UUID) -> ModelType | None:
        return session.get(self.model, id)

    def get_by_field(
        self, session: Session, field: str, value: Any
    ) -> ModelType | None:
        statement = select(self.model).where(getattr(self.model, field) == value)
        return session.exec(statement).first()

    def find(
        self,
        session: Session,
        skip: int = 0,
        limit: int = 100,
        **filters: Any,
    ) -> tuple[list[ModelType], int]:
        statement = select(self.model)

        for field, value in filters.items():
            if not value:
                statement = statement.where(getattr(self.model, field) == value)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def create(self, session: Session, obj_in: CreateSchemaType) -> ModelType:
        db_obj = self.model(**obj_in.model_dump())
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def update(
        self,
        session: Session,
        db_obj: ModelType,
        obj_in: UpdateSchemaType,
    ) -> ModelType:
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)

        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def delete(self, session: Session, db_obj: ModelType) -> None:
        session.delete(db_obj)
        session.commit()

    def soft_delete(self, session: Session, db_obj: ModelType) -> ModelType:
        db_obj.deleted = True
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj
