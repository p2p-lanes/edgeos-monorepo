"""Schemas for the per-human activity timeline (Shopify-style).

The timeline is built by aggregating the real source tables (applications,
payments, attendees) at read time, plus manual notes stored in `audit_logs`.
Every item carries an effective `occurred_at` used for sorting — for manual
notes this is the admin-chosen time, for the rest it is the row's real
timestamp.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class HumanActivityKind(str, Enum):
    """The kind of event a timeline item represents."""

    APPLICATION_SUBMITTED = "application.submitted"
    APPLICATION_ACCEPTED = "application.accepted"
    PAYMENT_COMPLETED = "payment.completed"
    TICKET_ADDED = "ticket.added"
    NOTE_ADDED = "note.added"
    RATING_CHANGED = "rating.changed"
    COMMENT_ADDED = "comment.added"

    # Credit movements (grant, debit at purchase, restore on expire/cancel).
    CREDIT_GRANTED = "credit.granted"
    CREDIT_APPLIED = "credit.applied"
    CREDIT_RESTORED = "credit.restored"


class HumanActivityProduct(BaseModel):
    """One purchased line in a `payment.completed` item (snapshot at purchase)."""

    product_name: str | None = None
    product_category: str | None = None
    quantity: int = 1


class HumanActivityItem(BaseModel):
    """A single entry in a human's activity timeline.

    `id` is a composite key (e.g. ``"payment:<uuid>"``) so it stays unique
    across the different source tables. `occurred_at` is the effective
    timestamp the feed sorts by.
    """

    id: str
    kind: HumanActivityKind
    occurred_at: datetime

    # Popup context (None for manual notes).
    popup_id: uuid.UUID | None = None
    popup_label: str | None = None

    # Per-kind payload.
    note: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    status: str | None = None
    products: list[HumanActivityProduct] = []

    # Rating change payload (only set for `rating.changed`): the new rating and
    # the previous one, both as HumanRating string values.
    rating: str | None = None
    previous_rating: str | None = None

    # Credit movement payload (only set for credit.* kinds).
    source: str | None = None
    balance_after: Decimal | None = None

    # Actor — set for items a backoffice user performed: manual notes, rating
    # changes and comments.
    actor_id: uuid.UUID | None = None
    actor_name: str | None = None
    actor_email: str | None = None


class HumanActivityCreate(BaseModel):
    """Request body for adding a manual note to a human's timeline."""

    note: str = Field(min_length=1, max_length=2000)
    occurred_at: datetime
