"""Restriction enforcement (sdd/sales-flows design D5/D6).

Two checks, both gated behind ONE flow (design):
1. `flow.restriction_rule` (if set) evaluates true for the request's
   `PurchaseContext` -> else the flow is closed to this buyer.
2. Every requested product is one this flow's ticketing steps actually
   offer (sdd/sales-flows-rediseno slice 4). The offer is derived from the
   steps — see `offering.py` — so there is nothing to keep in sync, and a
   direct POST can only buy what the checkout displayed.

`assert_products_allowed` is the hard-block call site (purchase paths):
raises 403 with a stable machine code (design D6) so the portal can render
i18n copy without shipping backend prose. `filter_allowed_products` is the
silent-filter call site (catalog reads): a failing restriction or an
excluded product is simply absent from the returned list, never an error —
matches every other portal listing's shape.

Anti-enumeration (G3, standing rule): both failure modes ("the flow's own
rule failed" vs "this flow does not offer that product") stay distinct
machine codes at every call site, authenticated and anonymous alike — same
precedent as `sales_flow/eligibility.py`'s deliberate 401/403 split. Neither
code exposes WHICH leaf predicate inside the rule failed (the evaluator only
ever returns a single boolean for the whole tree), and which products a
flow offers is not a secret: the checkout displays exactly that set to
anyone who opens it.
"""

import uuid

from fastapi import HTTPException, status
from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session

from app.services.restrictions.context import PurchaseContext
from app.services.restrictions.evaluator import evaluate
from app.services.restrictions.schemas import parse_restriction_rule

RESTRICTION_RULE_VIOLATED = "flow_restriction_violated"
PRODUCT_NOT_IN_FLOW = "product_not_in_flow"


def _restriction_passes(flow, context: PurchaseContext) -> bool:
    rule_data = getattr(flow, "restriction_rule", None)
    if not rule_data:
        return True
    try:
        node = parse_restriction_rule(rule_data)
    except ValidationError:
        logger.warning("Malformed restriction_rule on flow {} — denying", flow.id)
        return False
    return evaluate(node, context)


def _flow_allowed_product_ids(
    session: Session, flow, product_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of `product_ids` this flow's steps offer.

    Derived from the steps rather than stored, so the answer cannot drift
    from what the checkout displays — see `offering.py` for the rules.
    """
    from app.services.restrictions.offering import flow_offered_product_ids

    if not product_ids:
        return set()

    offered = flow_offered_product_ids(session, flow.id, flow.popup_id)
    return set(product_ids) & offered


def assert_products_allowed(
    session: Session,
    flow,
    popup,  # noqa: ARG001 — kept for signature symmetry with filter_allowed_products / design's call-site table
    product_ids: list[uuid.UUID],
    context: PurchaseContext,
) -> None:
    """Hard block (403) — call at every purchase-path call site, before any
    side effect (design: before `humans_crud.find_or_create` on the
    anonymous path, before the `SUPERSEDE_PENDING_ENABLED` block and the
    `FOR UPDATE` application lock on the authenticated path)."""
    if not _restriction_passes(flow, context):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": RESTRICTION_RULE_VIOLATED},
        )

    allowed_ids = _flow_allowed_product_ids(session, flow, product_ids)
    if set(product_ids) - allowed_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": PRODUCT_NOT_IN_FLOW},
        )


def filter_allowed_products(
    session: Session,
    flow,
    popup,  # noqa: ARG001
    products: list,
    context: PurchaseContext,
) -> list:
    """Silent filter — call at every catalog-read call site. A failing
    restriction_rule filters the WHOLE catalog to empty (the rule gates the
    flow, not individual products); what the steps offer filters
    per-product."""
    if not _restriction_passes(flow, context):
        return []

    allowed_ids = _flow_allowed_product_ids(session, flow, [p.id for p in products])
    return [p for p in products if p.id in allowed_ids]
