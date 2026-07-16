import re
import uuid
from typing import Self

from pydantic import EmailStr, model_validator
from sqlmodel import Field, SQLModel

from app.api.shared.enums import LandingMode
from app.utils.utils import slugify


def _validate_smtp_common(
    smtp_host: str | None,
    smtp_port: int | None,
    smtp_tls: bool | None,
    smtp_ssl: bool | None,
) -> None:
    if smtp_host is not None:
        if "://" in smtp_host or "/" in smtp_host or ":" in smtp_host:
            raise ValueError(
                "smtp_host must be a plain hostname (no scheme, path, or port)"
            )
        if not re.match(
            r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
            smtp_host,
        ):
            raise ValueError("smtp_host must be a valid hostname")
    if smtp_port is not None and not 1 <= smtp_port <= 65535:
        raise ValueError("smtp_port must be between 1 and 65535")
    if smtp_tls and smtp_ssl:
        raise ValueError("smtp_tls and smtp_ssl cannot both be true")


def _normalize_smtp_host(smtp_host: str | None) -> str | None:
    if smtp_host is None:
        return None
    stripped = smtp_host.strip()
    return stripped or None


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
    meta_tracking_enabled: bool = False
    meta_pixel_id: str | None = Field(default=None, max_length=64)
    ga_tracking_enabled: bool = False
    ga_measurement_id: str | None = Field(default=None, max_length=64)


class TenantCreate(SQLModel):
    name: str = Field(max_length=255)
    slug: str = ""
    sender_email: EmailStr | None = None
    sender_name: str | None = None
    image_url: str | None = None
    icon_url: str | None = None
    logo_url: str | None = None
    meta_tracking_enabled: bool = False
    meta_pixel_id: str | None = Field(default=None, max_length=64)
    ga_tracking_enabled: bool = False
    ga_measurement_id: str | None = Field(default=None, max_length=64)
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = 587
    smtp_user: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(
        default=None,
        exclude=True,
        schema_extra={"writeOnly": True},
    )
    smtp_tls: bool | None = True
    smtp_ssl: bool | None = False

    @model_validator(mode="after")
    def generate_slug(self) -> Self:
        self.slug = slugify(self.name)
        return self

    @model_validator(mode="after")
    def validate_sender_name(self) -> Self:
        if not self.sender_name:
            self.sender_name = self.name
        return self

    @model_validator(mode="after")
    def validate_smtp(self) -> Self:
        self.smtp_host = _normalize_smtp_host(self.smtp_host)
        _validate_smtp_common(
            self.smtp_host, self.smtp_port, self.smtp_tls, self.smtp_ssl
        )
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
    meta_tracking_enabled: bool | None = None
    meta_pixel_id: str | None = Field(default=None, max_length=64)
    meta_capi_access_token: str | None = Field(default=None, exclude=True)
    ga_tracking_enabled: bool | None = None
    ga_measurement_id: str | None = Field(default=None, max_length=64)
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = None
    smtp_user: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(
        default=None,
        exclude=True,
        schema_extra={"writeOnly": True},
    )
    smtp_tls: bool | None = None
    smtp_ssl: bool | None = None

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
    def validate_smtp(self) -> Self:
        self.smtp_host = _normalize_smtp_host(self.smtp_host)
        _validate_smtp_common(
            self.smtp_host, self.smtp_port, self.smtp_tls, self.smtp_ssl
        )
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
    meta_capi_configured: bool = False
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_tls: bool | None = None
    smtp_ssl: bool | None = None
    smtp_configured: bool = False
    smtp_password_configured: bool = False
    # Computed projection — NOT a DB column. Populated by the router after resolving
    # the active direct-sale popup for tenants in landing_mode=checkout.
    active_popup_slug: str | None = None


class TenantAnonymousPublic(TenantBase):
    id: uuid.UUID
    custom_domain_active: bool  # required, no default — forces non-optional in OpenAPI
    # Computed projection — NOT a DB column. Populated by the router after resolving
    # the active direct-sale popup for tenants in landing_mode=checkout.
    active_popup_slug: str | None = None


class TenantSmtpTestRequest(SQLModel):
    to_email: EmailStr | None = None


class TenantSmtpTestResponse(SQLModel):
    message: str
