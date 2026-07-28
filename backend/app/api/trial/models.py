import uuid
from datetime import datetime

from pydantic import field_validator
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, DateTime, Field, SQLModel


class PendingTrials(SQLModel, table=True):
    """Temporary table for self-serve trial signups awaiting OTP verification.

    DB fallback for the Redis pending-trial store (mirrors PendingHumans).
    Keyed by email only — the tenant does not exist until the code is
    verified. GLOBAL table: no tenant RLS policy, main engine only.
    """

    __tablename__ = "pending_trials"
    __table_args__ = (UniqueConstraint("email", name="uq_pending_trial_email"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    email: str = Field(max_length=255)
    gathering_name: str = Field(max_length=255)
    auth_code: str = Field(max_length=6)
    code_expiration: datetime = Field(sa_type=DateTime(timezone=True))
    attempts: int = Field(default=0)

    @field_validator("email", mode="after")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower().strip()
