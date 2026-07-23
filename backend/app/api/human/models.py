import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlmodel import Column, Field, Relationship, SQLModel

from app.api.group.models import GroupLeaders, GroupMembers
from app.api.human.schemas import HumanBase
from app.api.shared.enums import HumanRating

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.attendee.models import Attendees
    from app.api.group.models import Groups
    from app.api.tenant.models import Tenants


class Humans(HumanBase, table=True):
    __table_args__ = (
        UniqueConstraint("email", "tenant_id", name="uq_human_email_tenant_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="humans")

    # Applications submitted by this human
    applications: list["Applications"] = Relationship(back_populates="human")

    # Attendee records linked to this human (includes spouse attendees they later claimed)
    attendees: list["Attendees"] = Relationship(back_populates="human")

    # Groups where this human is a leader
    led_groups: list["Groups"] = Relationship(
        back_populates="leaders",
        link_model=GroupLeaders,
    )

    # Groups where this human is a member
    groups_as_member: list["Groups"] = Relationship(
        back_populates="members",
        link_model=GroupMembers,
    )

    @property
    def red_flag(self) -> bool:
        """Whether the human is blocked (rating == RED_FLAG).

        Derived from ``rating`` so existing gates that branch on the blocking
        state keep working after the red_flag boolean was replaced by the
        rating enum.
        """
        return self.rating == HumanRating.RED_FLAG

    @property
    def latest_application(self) -> "Applications | None":
        if not self.applications:
            return None
        return max(self.applications, key=lambda a: a.created_at)

    @property
    def display_name(self) -> str:
        if self.first_name or self.last_name:
            return f"{self.first_name or ''} {self.last_name or ''}".strip()
        return self.email

    @property
    def full_name(self) -> str | None:
        if self.first_name or self.last_name:
            return f"{self.first_name or ''} {self.last_name or ''}".strip()
        return None


class HumanComment(SQLModel, table=True):
    """A single comment in a human's flat discussion thread.

    Mirrors TaskComment: comments justify the human's rating, and the author
    identity (name/email) is snapshotted at write time so the thread stays
    readable even if the user is later renamed or removed.
    """

    __tablename__ = "human_comments"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)

    author_user_id: uuid.UUID | None = Field(
        default=None, foreign_key="users.id", nullable=True
    )
    author_name: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    author_email: str | None = Field(
        default=None, sa_column=Column(Text, nullable=True)
    )

    body: str = Field(sa_column=Column(Text, nullable=False))

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    # Set when the body is edited; surfaced as an "edited" marker in the UI.
    edited_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # Soft-delete: row is preserved, hidden from reads.
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )


class HumanEnrichmentFact(SQLModel, table=True):
    """One atomic, append-only fact the enrichment agent extracted about a human.

    The provenance bitácora behind ``humans.enriched_profile``: each row records
    a single value, where it came from (``source``) and the link to its evidence,
    so the curated profile can be traced back and re-derived if a source is
    corrected. Rows are never updated — a newer fact supersedes an older one.

    Like ``human_comments`` / the task tables this is reached only through the
    privileged main engine (authorization at the API layer), so it carries NO
    tenant RLS policy and NO grants to the tenant DB roles.
    """

    __tablename__ = "human_enrichment_facts"

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)

    # Profile attribute this fact informs (e.g. "organization", "interests").
    field: str = Field(sa_column=Column(String(100), nullable=False))
    # Extracted value / statement.
    value: str = Field(sa_column=Column(Text, nullable=False))
    # Provenance — see EnrichmentSource (telegram|event|custom_fields|org|manual).
    source: str = Field(sa_column=Column(String(20), nullable=False))
    # Permalink / event id / org URL backing the fact.
    evidence: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    # Agent's 0..1 confidence score, optional.
    confidence: float | None = Field(
        default=None, sa_column=Column(Numeric, nullable=True)
    )
    # Structured payload for traceability (message/chat/event ids, etc.).
    raw: dict | None = Field(default=None, sa_column=Column(JSONB, nullable=True))

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )


class HumanTelegramLink(SQLModel, table=True):
    """Derived binding between a Telegram account and an EdgeOS human.

    Telegram chat exports (and the live Bot API) identify an author by a stable
    numeric ``tg_user_id`` — the *export never contains the @handle*. This table
    is the durable join key that lets us attribute a downloaded conversation (or
    a new bot message) to a human deterministically by id, instead of guessing by
    display name on every re-run.

    IMPORTANT — this is an INTERNAL identity index, deliberately separate from
    ``humans.telegram``: that field is user-owned and user-visible, so we never
    write a handle we derived into it. The binding here may be high-confidence
    (a resolved/exact handle match) or weak (display-name only), in which case it
    stays ``verified = False`` until a human confirms it in the backoffice.

    Like ``human_enrichment_facts`` / ``human_comments`` it is reached only through
    the privileged main engine (authorization at the API layer), so it carries NO
    tenant RLS policy and NO grants to the tenant DB roles. A single ``tg_user_id``
    may bind to more than one human (the same person can be a human under several
    tenants), so uniqueness is on the (human, tg) pair, not on ``tg_user_id``.
    """

    __tablename__ = "human_telegram_links"
    __table_args__ = (
        UniqueConstraint(
            "human_id", "tg_user_id", name="uq_human_telegram_link_human_tg"
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(UUID(as_uuid=True), primary_key=True),
    )

    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)

    # Numeric Telegram user id as text (e.g. "7027773675"). This equals the chat
    # export's ``from_id`` with the "user" prefix stripped, and the Bot API's
    # ``message.from.id`` — the same id space across all three. Indexed for the
    # bot's lookup-by-id path.
    tg_user_id: str = Field(sa_column=Column(String(32), nullable=False, index=True))

    # Handle observed for this account (without "@"), when known. Evidence only —
    # NOT authoritative and NOT mirrored to humans.telegram.
    tg_username: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )
    # Display name observed in the group/export (changes over time; evidence only).
    tg_display_name: str | None = Field(
        default=None, sa_column=Column(String(255), nullable=True)
    )

    # See TelegramLinkMethod (handle_resolved|handle_exact|name_fuzzy|manual).
    match_method: str = Field(sa_column=Column(String(20), nullable=False))
    # 0..1 score of how sure we are this id is this human.
    confidence: float | None = Field(
        default=None, sa_column=Column(Numeric, nullable=True)
    )
    # Trust gate: only verified (or deterministic) links auto-attribute messages.
    verified: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )

    # Which exported group(s)/source(s) this link's evidence came from.
    source_groups: dict | None = Field(
        default=None, sa_column=Column(JSONB, nullable=True)
    )

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True), server_default=func.now(), nullable=False
        ),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            server_default=func.now(),
            onupdate=func.now(),
            nullable=False,
        ),
    )
