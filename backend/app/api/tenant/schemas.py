import re
import uuid
from typing import Self

from pydantic import EmailStr, model_validator
from sqlmodel import Field, SQLModel

from app.utils.utils import slugify


class TenantBase(SQLModel):
    name: str = Field(max_length=255)
    slug: str = Field(unique=True, index=True, max_length=255)
    deleted: bool = False
    sender_email: EmailStr | None = Field(default=None, max_length=255)
    sender_name: str | None = Field(default=None, max_length=255)
    image_url: str | None = None
    icon_url: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = Field(default=None, max_length=253)
    custom_domain_active: bool = False


class TenantCreate(SQLModel):
    name: str = Field(max_length=255)
    slug: str = ""
    sender_email: EmailStr | None = None
    sender_name: str | None = None
    image_url: str | None = None
    icon_url: str | None = None
    logo_url: str | None = None

    @model_validator(mode="after")
    def generate_slug(self) -> Self:
        self.slug = slugify(self.name)
        return self

    @model_validator(mode="after")
    def validate_sender_name(self) -> Self:
        if not self.sender_name:
            self.sender_name = self.name
        return self


class TenantUpdate(SQLModel):
    name: str | None = None
    slug: str | None = None
    sender_email: EmailStr | None = None
    sender_name: str | None = None
    image_url: str | None = None
    icon_url: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    custom_domain_active: bool | None = None

    @model_validator(mode="after")
    def regenerate_slug(self) -> Self:
        if self.name:
            self.slug = slugify(self.name)
        return self

    @model_validator(mode="after")
    def validate_custom_domain(self) -> Self:
        if self.custom_domain is not None:
            domain = self.custom_domain
            if "://" in domain or "/" in domain or ":" in domain:
                raise ValueError(
                    "custom_domain must be a plain hostname (no scheme, path, or port)"
                )
            if not re.match(
                r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
                domain,
            ):
                raise ValueError("custom_domain must be a valid hostname")
        return self


class TenantPublic(TenantBase):
    id: uuid.UUID
    custom_domain_active: bool  # required, no default — forces non-optional in OpenAPI
