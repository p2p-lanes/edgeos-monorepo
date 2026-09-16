import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.ticketing_step.schemas import TicketingStepBase

if TYPE_CHECKING:
    from app.api.popup.models import Popups
    from app.api.tenant.models import Tenants


class TicketingSteps(TicketingStepBase, table=True):
    """A single step in the checkout journey of ONE sales flow.

    `sales_flow_id` is required (sdd/sales-flows-rediseno slice 2): a step
    belongs to exactly one flow and is never shared or inherited. A flow
    that owns no steps has no steps — it does not borrow another flow's.
    `uq_ticketing_step_patron_flow` keys the one-enabled-patron-step
    invariant to that same unit. See migration
    `c5a71e3f8b24_steps_flow_required.py`.
    """

    __table_args__ = (
        Index(
            "uq_ticketing_step_patron_flow",
            "sales_flow_id",
            unique=True,
            postgresql_where=text("template = 'patron-preset' AND is_enabled = TRUE"),
        ),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(
            UUID(as_uuid=True),
            primary_key=True,
        ),
    )

    tenant: "Tenants" = Relationship(back_populates="ticketing_steps")
    popup: "Popups" = Relationship(back_populates="ticketing_steps")
