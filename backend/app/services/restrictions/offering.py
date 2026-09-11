"""What a sales flow offers, derived from its own ticketing steps.

Design: sdd/sales-flows-rediseno slice 4 — a product is purchasable through
a flow only if that flow's checkout offers it. The offer already exists in
the steps, so it is read from there rather than mirrored into a second
table that would have to be kept in sync.

Each enabled step contributes:

- nothing, when it has no `product_category` (confirm, buyer, content-only
  steps sell nothing);
- the product ids listed in its `template_config.sections[].product_ids`,
  when the step curates its sections. `ticketSections.ts::buildSectionGroups`
  renders ONLY the listed products, so curation is a restriction and this
  mirrors it;
- otherwise every active product of the step's `product_category`, matching
  `useStepProductResolver`'s category filter and the no-sections fallback;
- the shadow products of the rooms an `accommodation-booking` step offers,
  which no `product_category` can reach; see `_accommodation_product_ids`.

This closes a gap the original considerations doc flagged and slice 12 left
open: section curation was frontend-only, so a direct POST could buy a
product the flow never displayed. Enforcement now matches what the buyer
was actually offered.

Deleted steps and disabled steps offer nothing, so disabling a step also
stops its products being purchasable through that flow — the same thing the
buyer sees.
"""

import uuid
from typing import Any

from sqlmodel import Session, select


def _curated_product_ids(template_config: Any) -> set[uuid.UUID]:
    """Product ids explicitly listed on a step's sections.

    Returns an empty set when the step has no usable curation, which the
    caller reads as "this step offers its whole category". Malformed config
    degrades the same way: a broken section list must not silently narrow
    what a buyer can pay for, because the step still renders the category
    fallback.
    """
    if not isinstance(template_config, dict):
        return set()

    sections = template_config.get("sections")
    if not isinstance(sections, list):
        return set()

    ids: set[uuid.UUID] = set()
    for section in sections:
        if not isinstance(section, dict):
            continue
        raw_ids = section.get("product_ids")
        if not isinstance(raw_ids, list):
            continue
        for raw in raw_ids:
            try:
                ids.add(uuid.UUID(str(raw)))
            except (ValueError, AttributeError, TypeError):
                continue
    return ids


def _accommodation_product_ids(
    session: Session, flow_id: uuid.UUID, popup_id: uuid.UUID
) -> set[uuid.UUID]:
    """Shadow products of the rooms this flow's accommodation step offers.

    The category loop cannot see them. An ``accommodation-booking`` step has
    no ``product_category`` at all: the template is content-only in the
    backoffice, which sends null on create and hides the field afterwards.
    Meanwhile the rooms it sells are ordinary ``Products`` rows behind the
    scenes (``category="housing"``, ``managed_by="accommodation"``, in
    ``accommodation/crud.py``), so a flow whose only lodging step is an
    accommodation step offered nothing and every booking through it was
    refused with ``product_not_in_flow``. It worked only where the seeded
    legacy ``housing-date`` step was still enabled, whose open ``housing``
    category swept the shadow products up by accident.

    Read through the same ``step_offer`` the checkout reads it through, so
    what this calls offered cannot drift from what the step displays. The
    subset is applied here too, which means a room from a property the step
    does not offer is refused at this gate rather than at
    ``payments.resolve_lines``'s more specific one. Both refuse it; only the
    code the buyer never sees differs.
    """
    from app.api.accommodation.crud import accommodations_crud
    from app.api.accommodation.payments import step_offer

    offer = step_offer(session, popup_id, flow_id)
    if not offer.enabled:
        return set()

    rooms = accommodations_crud.find_by_popup(
        session,
        popup_id,
        property_ids=offer.property_ids or None,
        checkout_only=True,
    )
    return {room.product_id for room in rooms if room.product_id is not None}


def flow_offered_product_ids(
    session: Session, flow_id: uuid.UUID, popup_id: uuid.UUID
) -> set[uuid.UUID]:
    """Every product id this flow's enabled steps offer."""
    from app.api.accommodation.constants import ACCOMMODATION_STEP_TEMPLATE
    from app.api.product.models import Products
    from app.api.ticketing_step.models import TicketingSteps

    steps = list(
        session.exec(
            select(TicketingSteps).where(
                TicketingSteps.sales_flow_id == flow_id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
        ).all()
    )

    offered: set[uuid.UUID] = set()
    open_categories: set[str] = set()

    for step in steps:
        if not step.product_category:
            continue
        curated = _curated_product_ids(step.template_config)
        if curated:
            offered |= curated
        else:
            open_categories.add(step.product_category.lower())

    if open_categories:
        rows = session.exec(
            select(Products.id, Products.category).where(
                Products.popup_id == popup_id,
                Products.is_active == True,  # noqa: E712
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
        ).all()
        for product_id, category in rows:
            if category and category.lower() in open_categories:
                offered.add(product_id)

    if any(step.template == ACCOMMODATION_STEP_TEMPLATE for step in steps):
        offered |= _accommodation_product_ids(session, flow_id, popup_id)

    return offered
