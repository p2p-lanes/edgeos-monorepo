import re
import uuid
from typing import Self

from pydantic import EmailStr, model_validator
from sqlmodel import Field, SQLModel

from app.api.shared.enums import LandingMode
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
    landing_mode: LandingMode = LandingMode.portal


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
    sender_email: EmailStr | None = None
    sender_name: str | None = None
    image_url: str | None = None
    icon_url: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    custom_domain_active: bool | None = None
    landing_mode: LandingMode | None = None

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

    @model_validator(mode="after")
    def validate_landing_mode(self) -> Self:
        """Reject landing_mode=checkout when the same payload explicitly invalidates it.

        ADR-1 (option A): schema-level check catches obvious bad payloads.
        The router performs the definitive merged-state check against the DB row.

        Rules checked here (payload-level only — None means "not changing"):
        - checkout + custom_domain_active=False explicitly in payload → rejected (R-T2)
        - checkout + custom_domain_active=True AND custom_domain=None in payload → rejected (R-T2)
          (Only when custom_domain_active is explicitly True in payload and no domain provided)

        When custom_domain and/or custom_domain_active are omitted from the payload
        (None = "unchanged"), validation defers to the router's merged-state check.
        """
        if self.landing_mode != LandingMode.checkout:
            return self

        # Explicit deactivation in same payload
        if self.custom_domain_active is False:
            raise ValueError(
                "landing_mode=checkout requires custom_domain_active=True. "
                "Set custom_domain_active to true first."
            )

        # If custom_domain_active is explicitly True in this payload but no domain provided
        if self.custom_domain_active is True and self.custom_domain is None:
            raise ValueError(
                "landing_mode=checkout requires a non-null custom_domain. "
                "Set a custom_domain before switching to checkout mode."
            )

        # If both are absent from the payload (None), defer to router merged-state check.
        # This allows: PATCH {"landing_mode": "checkout"} when DB already has domain active.

        return self


class TenantPublic(TenantBase):
    id: uuid.UUID
    custom_domain_active: bool  # required, no default — forces non-optional in OpenAPI
    # Computed projection — NOT a DB column. Populated by the router after resolving
    # the active direct-sale popup for tenants in landing_mode=checkout.
    active_popup_slug: str | None = None
    # Display fragment for the third-party key (prefix only — hash is NEVER exposed).
    third_party_key_prefix: str | None = None


class ThirdPartyKeyRotated(SQLModel):
    """Returned by the rotate endpoint. The raw api_key is shown ONCE and never stored."""

    api_key: str
    prefix: str
