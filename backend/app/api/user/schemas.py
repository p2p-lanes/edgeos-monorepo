import uuid
from datetime import datetime

from pydantic import EmailStr
from sqlmodel import Field, SQLModel

from app.api.shared.enums import UserRole


class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    full_name: str | None = Field(default=None, max_length=255)
    role: UserRole
    deleted: bool = False
    tenant_id: uuid.UUID | None = Field(default=None, foreign_key="tenants.id")

    auth_code: str | None = Field(default=None, max_length=6)
    code_expiration: datetime | None = Field(default=None)
    auth_attempts: int = Field(default=0)


class UserCreate(UserBase): ...


class UserPublic(UserBase):
    id: uuid.UUID


class UserUpdate(SQLModel):
    email: EmailStr | None = None
    full_name: str | None = None
    role: UserRole | None = None
