from enum import StrEnum
from typing import Self
from urllib.parse import quote

from dotenv import load_dotenv
from pydantic import (
    EmailStr,
    Field,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


class Environment(StrEnum):
    DEV = "dev"
    STAGING = "staging"
    PRODUCTION = "production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = Field(...)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    BACKOFFICE_URL: str = "http://localhost:5173"
    ENVIRONMENT: Environment = Environment.DEV
    # Minimum level emitted by the loguru stdout sink. Set to DEBUG for verbose
    # local debugging; INFO keeps production logs to signal + request lines.
    LOG_LEVEL: str = "INFO"

    PROJECT_NAME: str = Field(...)
    SENTRY_DSN: HttpUrl | None = None
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    POSTGRES_SERVER: str = Field(...)
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = Field(...)
    POSTGRES_PASSWORD: str = Field(...)
    POSTGRES_DB: str = ""
    POSTGRES_SSL_MODE: str = "require"

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return PostgresDsn.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=quote(self.POSTGRES_PASSWORD, safe=""),
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
            query=f"sslmode={self.POSTGRES_SSL_MODE}",
        )

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SENDER_EMAIL: EmailStr | None = None
    SENDER_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_sender_name(self) -> Self:
        if not self.SENDER_NAME:
            self.SENDER_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.SENDER_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"

    SUPERADMIN: EmailStr = Field(...)

    # Storage configuration (S3-compatible)
    STORAGE_ENDPOINT_URL: str | None = None  # None = AWS S3
    STORAGE_ACCESS_KEY: str = ""
    STORAGE_SECRET_KEY: str = ""
    STORAGE_BUCKET: str = "uploads"
    STORAGE_REGION: str = "us-east-2"
    STORAGE_PUBLIC_URL: str | None = None  # Optional CDN/public URL prefix

    @computed_field
    @property
    def storage_enabled(self) -> bool:
        return bool(self.STORAGE_ACCESS_KEY and self.STORAGE_SECRET_KEY)

    REDIS_URL: str | None = None

    # AI Translation (Gemini)
    GEMINI_API_KEY: str | None = None

    # SimpleFI payment provider
    BACKEND_URL: str = "http://localhost:8000"
    PORTAL_URL: str = "http://localhost:3000"

    @computed_field
    @property
    def PORTAL_DOMAIN(self) -> str:
        from urllib.parse import urlparse

        return urlparse(self.PORTAL_URL).hostname or ""

    @computed_field
    @property
    def SIMPLEFI_API_URL(self) -> str:
        if self.ENVIRONMENT == Environment.PRODUCTION:
            return "https://api.simplefi.tech"
        return "https://apidev.simplefi.tech"

    # SimpleFi installment plans accept max_installments in [2, 12].
    # This is a global safety net; per-popup `installments_max` may set a lower cap.
    MAX_ALLOWED_INSTALLMENTS: int = 12

    # ---------------------------------------------------------------------------
    # Pending payment sweeper + supersede (ADR-5; global, not per-popup)
    # These are provider-level operational constants, not per-tenant product flags.
    # ---------------------------------------------------------------------------

    # Master kill-switch for the sweeper job. Set to false to disable globally.
    PENDING_SWEEP_ENABLED: bool = True

    # Age threshold (minutes) beyond which a PENDING SimpleFi payment is a
    # candidate for status reconciliation. Default matches SimpleFi's ~15-min
    # provider-side expiry with a safety margin.
    PENDING_SWEEP_STALE_MINUTES: int = 20

    # Maximum number of stale payments processed per sweeper run. Keeps each
    # run bounded and predictable.
    PENDING_SWEEP_BATCH_SIZE: int = 200

    # When true, supersede_pending_payments runs at the start of create_payment
    # and create_open_ticketing_payment to cancel the buyer's prior PENDING
    # payment before creating a new one.
    SUPERSEDE_PENDING_ENABLED: bool = True


settings = Settings()
