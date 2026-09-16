import uuid
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Text
from sqlmodel import Field, SQLModel


class EmailTemplateType(StrEnum):
    LOGIN_CODE_USER = "login_code_user"
    LOGIN_CODE_HUMAN = "login_code_human"
    APPLICATION_RECEIVED = "application_received"
    APPLICATION_ACCEPTED = "application_accepted"
    APPLICATION_REJECTED = "application_rejected"
    APPLICATION_ACCEPTED_WITH_DISCOUNT = "application_accepted_with_discount"
    APPLICATION_ACCEPTED_WITH_INCENTIVE = "application_accepted_with_incentive"
    APPLICATION_ACCEPTED_SCHOLARSHIP_REJECTED = (
        "application_accepted_scholarship_rejected"
    )
    PAYMENT_CONFIRMED = "payment_confirmed"
    ABANDONED_CART = "abandoned_cart"
    PURCHASE_REMINDER = "purchase_reminder"
    ABANDONED_APPLICATION = "abandoned_application"
    EDIT_PASSES_CONFIRMED = "edit_passes_confirmed"
    EVENT_INVITATION = "event_invitation"
    EVENT_UPDATED = "event_updated"
    EVENT_CANCELLED = "event_cancelled"
    EVENT_RSVP_CANCELLED = "event_rsvp_cancelled"
    EVENT_APPROVAL_APPROVED = "event_approval_approved"
    EVENT_APPROVAL_REJECTED = "event_approval_rejected"
    CHECK_IN_PASS = "check_in_pass"


class TemplateScope(StrEnum):
    """Who owns a template, and therefore where the send path looks for it.

    Exactly one tier per type — a scope is not a chain
    (sdd/sales-flows-rediseno R1). FLOW covers the mails a sale produces,
    POPUP the ones a gathering produces regardless of how anyone bought,
    and TENANT the ones that belong to no gathering at all.
    """

    TENANT = "tenant"
    POPUP = "popup"
    FLOW = "flow"


class EmailTemplateBase(SQLModel):
    tenant_id: uuid.UUID = Field(foreign_key="tenants.id", index=True)
    popup_id: uuid.UUID | None = Field(
        default=None, foreign_key="popups.id", index=True
    )
    # sdd/sales-flows slice 10: three-tier resolution (flow -> popup ->
    # tenant/file, services/email/service.py). NULL = popup-shared tier,
    # matching every other flow cutover's nullable-column shape (D1/D2).
    sales_flow_id: uuid.UUID | None = Field(
        default=None, foreign_key="sales_flows.id", index=True
    )
    template_type: str = Field(index=True)
    subject: str | None = Field(default=None, nullable=True)
    html_content: str = Field(sa_type=Text())
    is_active: bool = Field(default=True)


class EmailTemplatePublic(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    popup_id: uuid.UUID | None
    sales_flow_id: uuid.UUID | None = None
    template_type: str
    scope: TemplateScope
    subject: str | None = None
    html_content: str
    is_active: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class EmailTemplateCreate(BaseModel):
    popup_id: uuid.UUID | None = None
    sales_flow_id: uuid.UUID | None = None
    template_type: str
    subject: str | None = None
    html_content: str
    is_active: bool = True

    model_config = ConfigDict(str_strip_whitespace=True)


class EmailTemplateUpdate(BaseModel):
    subject: str | None = None
    html_content: str | None = None
    is_active: bool | None = None
