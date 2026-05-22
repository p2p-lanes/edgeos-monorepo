import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum, StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import Boolean, Numeric, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Column, DateTime, Field, SQLModel

from app.api.application_review.schemas import ReviewDecision
from app.api.attendee.schemas import AttendeePublic
from app.api.human.schemas import HumanPublic


class ApplicationStatus(str, Enum):
    """Status for applications."""

    DRAFT = "draft"
    PENDING_FEE = "pending_fee"
    IN_REVIEW = "in review"
    REJECTED = "rejected"
    ACCEPTED = "accepted"
    WITHDRAWN = "withdrawn"


class UserSettableStatus(str, Enum):
    """Statuses that users can set (subset of ApplicationStatus)."""

    DRAFT = "draft"
    IN_REVIEW = "in review"


class ScholarshipStatus(StrEnum):
    """Status of a scholarship request on an application."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ApplicationBase(SQLModel):
    """Base schema for applications.

    An Application is a form submitted by a Human to participate in a Popup.
    Profile data lives on Human; Application only stores popup-specific data.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID = Field(foreign_key="popups.id", index=True)
    human_id: uuid.UUID = Field(foreign_key="humans.id", index=True)
    group_id: uuid.UUID | None = Field(
        default=None, foreign_key="groups.id", nullable=True, index=True
    )

    # Popup-specific fields
    referral: str | None = Field(default=None, nullable=True, max_length=255)

    info_not_shared: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String), nullable=False, server_default="{}"),
    )

    # Status and review
    status: str = Field(default=ApplicationStatus.DRAFT.value, index=True)

    # Dynamic form fields (popup-specific questions)
    custom_fields: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="'{}'"),
    )
    custom_fields_schema: dict | None = Field(
        default=None,
        sa_column=Column(JSONB, nullable=True),
    )

    # Credit balance (remaining credit from edit-passes overpayment)
    credit: Decimal = Field(
        default=Decimal("0"),
        sa_column=Column(Numeric(10, 2), nullable=False, server_default="0"),
    )

    # Timestamps
    submitted_at: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )
    accepted_at: datetime | None = Field(
        default=None, nullable=True, sa_type=DateTime(timezone=True)
    )

    # Scholarship request fields (human-submitted)
    scholarship_request: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, server_default="false"),
    )
    scholarship_details: str | None = Field(
        default=None, sa_column=Column(Text(), nullable=True)
    )
    scholarship_video_url: str | None = Field(default=None, nullable=True)

    # Scholarship decision fields (admin-assigned)
    scholarship_status: str | None = Field(default=None, nullable=True)
    discount_percentage: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(5, 2), nullable=True),
    )
    incentive_amount: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(12, 2), nullable=True),
    )
    incentive_currency: str | None = Field(default=None, max_length=10, nullable=True)

    # Groups-rework: attribution columns for invite/referral flows
    invite_id: uuid.UUID | None = Field(
        default=None, foreign_key="invites.id", nullable=True
    )
    referral_id: uuid.UUID | None = Field(
        default=None, foreign_key="referrals.id", nullable=True
    )


class ApplicationPublic(BaseModel):
    """Application schema for API responses."""

    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID
    human_id: uuid.UUID
    group_id: uuid.UUID | None = None

    # Popup-specific
    referral: str | None = None
    info_not_shared: list[str] = []
    status: str
    custom_fields: dict = {}
    custom_fields_schema: dict | None = None

    # Credit balance
    credit: Decimal = Decimal("0")

    # Timestamps
    submitted_at: datetime | None = None
    accepted_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Scholarship fields
    scholarship_request: bool = False
    scholarship_details: str | None = None
    scholarship_video_url: str | None = None
    scholarship_status: str | None = None
    discount_percentage: Decimal | None = None
    incentive_amount: Decimal | None = None
    incentive_currency: str | None = None

    # Related data
    human: HumanPublic | None = None
    attendees: list[AttendeePublic] = []

    # Computed fields
    red_flag: bool = False
    review_decision: ReviewDecision | None = None

    model_config = ConfigDict(from_attributes=True)


class ApplicationCreate(BaseModel):
    """Application schema for creation.

    Profile fields can be provided here and will update the Human record.
    Companions (spouse/kids) can be added during initial submission.
    """

    popup_id: uuid.UUID

    # Profile fields (will be saved to Human)
    first_name: str
    last_name: str
    email: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    # Application-specific fields
    referral: str | None = None
    info_not_shared: list[str] | None = None
    custom_fields: dict | None = None
    status: UserSettableStatus | None = None
    human_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None  # Optional group to join

    # Scholarship request (human-submittable fields only)
    scholarship_request: bool = False
    scholarship_details: str | None = None
    scholarship_video_url: str | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str | None) -> str | None:
        if v:
            return v.lower().strip()
        return v

    model_config = ConfigDict(str_strip_whitespace=True)


class ApplicationUpdate(BaseModel):
    """Application schema for updates by the applicant.

    Profile fields will update the Human record.
    """

    # Profile fields (updates Human)
    first_name: str | None = None
    last_name: str | None = None
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    # Application-specific fields
    referral: str | None = None
    info_not_shared: list[str] | None = None
    custom_fields: dict | None = None
    status: UserSettableStatus | None = None
    group_id: uuid.UUID | None = None

    # Scholarship human-editable fields (admin-only decision fields excluded)
    scholarship_request: bool | None = None
    scholarship_details: str | None = None
    scholarship_video_url: str | None = None


class ApplicationAdminCreate(BaseModel):
    """Application schema for admin creation.

    Admins can create applications on behalf of users and set any status.
    If email is provided and human doesn't exist, a new Human record is created.
    Companions (spouse/kids) can be added during initial submission.
    """

    popup_id: uuid.UUID

    # Profile fields (will be saved to Human)
    first_name: str | None = None
    last_name: str | None = None
    email: str  # Required for admin creation
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    # Application-specific fields
    referral: str | None = None
    info_not_shared: list[str] | None = None
    custom_fields: dict | None = None
    status: ApplicationStatus = ApplicationStatus.DRAFT
    group_id: uuid.UUID | None = None

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        return v.lower().strip()

    model_config = ConfigDict(str_strip_whitespace=True)


class GrantProductItem(BaseModel):
    """One product line in the admin bulk-grant request."""

    product_id: uuid.UUID
    quantity: int = 1

    @field_validator("quantity")
    @classmethod
    def validate_quantity(cls, v: int) -> int:
        if v < 1:
            raise ValueError("quantity must be >= 1")
        return v


class PersonGrantItem(BaseModel):
    """One row of the admin bulk-grant CSV: a person to grant tickets to."""

    email: str
    first_name: str | None = None
    last_name: str | None = None
    products: list[GrantProductItem]

    @field_validator("email")
    @classmethod
    def clean_email(cls, v: str) -> str:
        return v.lower().strip()

    @field_validator("products")
    @classmethod
    def _non_empty(cls, v: list[GrantProductItem]) -> list[GrantProductItem]:
        if not v:
            raise ValueError("each person needs at least one product")
        return v

    model_config = ConfigDict(str_strip_whitespace=True)


class AdminGrantTicketsRequest(BaseModel):
    """Admin bulk-grant request: assign N free tickets to M people for a popup."""

    popup_id: uuid.UUID
    people: list[PersonGrantItem]

    @field_validator("people")
    @classmethod
    def validate_people(cls, v: list[PersonGrantItem]) -> list[PersonGrantItem]:
        if not v:
            raise ValueError("At least one person is required")
        return v


class GrantedPaymentInfo(BaseModel):
    """One $0 payment created by the admin bulk-grant flow."""

    payment_id: uuid.UUID
    application_id: uuid.UUID
    human_id: uuid.UUID
    email: str
    tickets_created: int


class AdminGrantTicketsResponse(BaseModel):
    """Response payload from POST /applications/admin/grant-tickets."""

    granted: list[GrantedPaymentInfo]


class ApplicationFilter(BaseModel):
    """Filters for application queries."""

    popup_id: uuid.UUID | None = None
    human_id: uuid.UUID | None = None
    status: ApplicationStatus | None = None
    email: str | None = None
    scholarship_status: str | None = None


class ScholarshipDecisionRequest(BaseModel):
    """Admin request body for PATCH /applications/{id}/scholarship."""

    scholarship_status: ScholarshipStatus  # required: "approved" | "rejected"
    discount_percentage: Decimal | None = None  # 0–100, required when approved
    incentive_amount: Decimal | None = None  # only if popup.allows_incentive
    incentive_currency: str | None = None  # required if incentive_amount set

    model_config = ConfigDict(str_strip_whitespace=True)


class DetachCompanionRequest(BaseModel):
    """Request body for POST /applications/my/detach-companion."""

    popup_id: uuid.UUID


class ApplicationSnapshotBase(SQLModel):
    """Base schema for application snapshots.

    A snapshot captures the state of a Human's profile at the time of
    application submission or status change. This preserves historical data.
    """

    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    application_id: uuid.UUID = Field(foreign_key="applications.id", index=True)

    # Snapshot trigger
    event: str = Field(max_length=50)  # e.g., "submitted", "accepted", "updated"

    # Human profile snapshot at this moment
    first_name: str | None = None
    last_name: str | None = None
    email: str
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    # Application data snapshot
    referral: str | None = None
    info_not_shared: list[str] = Field(
        default_factory=list,
        sa_column=Column(ARRAY(String), nullable=False, server_default="{}"),
    )
    custom_fields: dict = Field(
        default_factory=dict,
        sa_column=Column(JSONB, nullable=False, server_default="'{}'"),
    )
    status: str


class ApplicationSnapshotPublic(BaseModel):
    """Application snapshot for API responses."""

    id: uuid.UUID
    application_id: uuid.UUID
    event: str
    created_at: datetime

    # Human profile at snapshot time
    first_name: str | None = None
    last_name: str | None = None
    email: str
    telegram: str | None = None
    gender: str | None = None
    age: str | None = None
    residence: str | None = None

    # Application data at snapshot time
    referral: str | None = None
    info_not_shared: list[str] = []
    custom_fields: dict = {}
    status: str

    model_config = ConfigDict(from_attributes=True)


class AttendeeTicketInfo(BaseModel):
    """Per-ticket info exposed on companion participation responses.

    `check_in_code` is the per-ticket code from `attendee_products`. Check-in
    codes belong to purchased tickets, not to attendees.

    `product_name`, `product_category`, and `requires_check_in` are
    denormalized from the related Product so the portal can render the same
    per-ticket QR list the main applicant sees without an extra round-trip.

    `last_scan_at` is the most recent occurred_at from check_ins for this
    ticket (None when never scanned). The portal uses it to flag already-used
    QR codes — same behavior as the main applicant's pass view.
    """

    id: uuid.UUID
    check_in_code: str
    product_name: str | None = None
    product_category: str | None = None
    requires_check_in: bool = False
    last_scan_at: datetime | None = None


class AttendeeInfo(BaseModel):
    """Minimal attendee information for participation responses."""

    id: uuid.UUID
    name: str
    category: str | None = None
    tickets: list[AttendeeTicketInfo] = []


class ApplicantParticipation(BaseModel):
    """Response when human is the main applicant."""

    type: Literal["applicant"] = "applicant"
    application_id: uuid.UUID
    status: str  # ApplicationStatus value


class CompanionParticipation(BaseModel):
    """Response when human is a companion on someone else's application."""

    type: Literal["companion"] = "companion"
    attendee: AttendeeInfo
    application_status: str  # Parent application status
    owner_email: str | None = None  # Email of the application owner (for UX copy)


class NoParticipation(BaseModel):
    """Response when human has no participation in the popup."""

    type: Literal["none"] = "none"


ParticipationResponse = (
    ApplicantParticipation | CompanionParticipation | NoParticipation
)


class AttendeeDirectoryEntry(BaseModel):
    """Entry for attendee directory listing."""

    id: uuid.UUID
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    telegram: str | None = None
    role: str | None = None
    organization: str | None = None
    residence: str | None = None
    age: str | None = None
    gender: str | None = None


class AttendeeDirectoryFilter(BaseModel):
    """Filters for attendee directory."""

    q: str | None = None
    email: str | None = None


class DirectoryProduct(BaseModel):
    """Minimal product info for directory participation display."""

    id: uuid.UUID
    name: str
    slug: str
    category: str | None = None
    duration_type: str | None = None


class AssociatedAttendee(BaseModel):
    """Non-main attendee summary for directory."""

    name: str
    category: str | None = None
    gender: str | None = None
    email: str | None = None


class PopupAccessResponse(BaseModel):
    """Response schema for GET /portal/popup/{popup_id}/access.

    Encodes the result of the 7-step access ladder for the authenticated Human.
    allowed=True means the Human can view the passes page.
    source indicates which ladder step granted access (None when denied).
    application_status carries the Application status string when one exists.
    reason explains the denial when allowed=False.
    """

    allowed: bool
    source: Literal["application", "attendee", "payment", "companion"] | None = None
    application_status: (
        Literal["accepted", "submitted", "in review", "rejected"] | None
    ) = None
    reason: (
        Literal["no_access", "application_pending", "application_rejected"] | None
    ) = None


class AttendeesDirectoryEntry(BaseModel):
    """Single entry in the attendees directory."""

    id: uuid.UUID  # application id

    # Human profile (from application.human)
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    telegram: str | None = None
    role: str | None = None
    organization: str | None = None
    residence: str | None = None
    age: str | None = None
    gender: str | None = None
    picture_url: str | None = None

    # Participation
    participation: list[DirectoryProduct] = []

    # Associated attendees (spouse/kids)
    associated_attendees: list[AssociatedAttendee] = []

    model_config = ConfigDict(from_attributes=True)
