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
    """A single step in a popup's checkout journey, or — when
    `sales_flow_id` is set — a step owned exclusively by one specific sales
    flow of that popup (sdd/sales-flows slice 8). A flow that owns ANY step
    row uses ONLY its own list; zero rows falls back to the popup-shared
    tier (`sales_flow_id IS NULL`). `uq_ticketing_step_patron_flow` /
    `uq_ticketing_step_patron_popup_shared` re-key the pre-existing
    one-enabled-patron-step-per-popup invariant to this same two-tier
    shape. See migration `96ca481168da_add_flow_id_to_ticketing_steps.py`.
    """

    __table_args__ = (
        Index(
            "uq_ticketing_step_patron_flow",
            "sales_flow_id",
            unique=True,
            postgresql_where=text(
                "template = 'patron-preset' AND is_enabled = TRUE "
                "AND sales_flow_id IS NOT NULL"
            ),
        ),
        Index(
            "uq_ticketing_step_patron_popup_shared",
            "popup_id",
            unique=True,
            postgresql_where=text(
                "template = 'patron-preset' AND is_enabled = TRUE "
                "AND sales_flow_id IS NULL"
            ),
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
