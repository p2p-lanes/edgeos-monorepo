"""Service-layer validators for product inventory rules.

These validators require DB session access and therefore cannot live inside
Pydantic model_validators. They are called from CRUD methods and must be
invoked before any DB writes.
"""

import uuid

from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.product.models import TicketTierGroup, TicketTierPhase


def assert_no_total_vs_shared_stock_conflict(
    session: Session,
    product_id: uuid.UUID | None,
    proposed_total_stock_cap: int | None,
) -> None:
    """Raise HTTP 422 if proposed_total_stock_cap conflicts with the tier-group model.

    Called on:
      - ProductsCRUD.create  (product_id may be None — skip, no phase row yet)
      - ProductsCRUD.update  (product_id known)
      - TierPhasesCRUD.create_for_group (product_id known, check from association side)

    A conflict exists when:
      - proposed_total_stock_cap is NOT NULL, AND
      - the product belongs to a TicketTierGroup whose shared_stock_cap is NOT NULL.

    Two inventory models (total-stock cap + shared-stock cap) on the same product
    are forbidden per architect-locked decision D1. Choosing both creates an
    ambiguous "which cap wins?" UX trap with no real-world benefit.
    """
    if proposed_total_stock_cap is None:
        return  # NULL = unlimited — no conflict possible
    if product_id is None:
        return  # creation flow before the phase row exists — no conflict yet

    stmt = (
        select(TicketTierGroup.shared_stock_cap)
        .join(TicketTierPhase, TicketTierPhase.group_id == TicketTierGroup.id)
        .where(TicketTierPhase.product_id == product_id)
    )
    row = session.exec(stmt).first()
    if row is not None and row is not None and row != (None,):
        # row is the shared_stock_cap value directly (scalar select)
        shared_cap = row if not isinstance(row, tuple) else row[0]
        if shared_cap is not None:
            raise HTTPException(
                status_code=422,
                detail=(
                    "total_stock_cap cannot coexist with a tier-group shared_stock_cap. "
                    "Choose one inventory model per product."
                ),
            )
