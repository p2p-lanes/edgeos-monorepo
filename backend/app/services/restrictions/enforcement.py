"""Restriction enforcement (sdd/sales-flows design D5/D6).

Two checks, both gated behind ONE flow (design):
1. `flow.restriction_rule` (if set) evaluates true for the request's
   `PurchaseContext` -> else the flow is closed to this buyer.
2. Every requested product is assigned to this flow via `flow_products`
   (sdd/sales-flows-rediseno slice 4, R6). Assignment is the only way in: a
   product assigned nowhere sells nowhere. The earlier rule — an empty
   assignment meaning "available in every flow" — is gone, along with the
   surprise that assigning a product to one flow removed it from the rest.

`assert_products_allowed` is the hard-block call site (purchase paths):
raises 403 with a stable machine code (design D6) so the portal can render
i18n copy without shipping backend prose. `filter_allowed_products` is the
silent-filter call site (catalog reads): a failing restriction or an
excluded product is simply absent from the returned list, never an error —
matches every other portal listing's shape.

Anti-enumeration (G3, standing rule): both failure modes ("the flow's own
rule failed" vs "this product belongs to a different flow") stay distinct
machine codes at every call site, authenticated and anonymous alike — same
precedent as `sales_flow/eligibility.py`'s deliberate 401/403 split. Neither
code exposes WHICH leaf predicate inside the rule failed (the evaluator only
ever returns a single boolean for the whole tree), and a flow's product
assignment is not a secret: it is the same fact `flow_products` already
exposes to any backoffice operator and that a determined buyer could infer
from repeated purchase attempts regardless of the error code's precision.
"""

import uuid

from fastapi import HTTPException, status
from loguru import logger
from pydantic import ValidationError
from sqlmodel import Session, select

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
    session: Session, flow_id: uuid.UUID, product_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Product IDs (from `product_ids`) assigned to `flow_id`.

    A product sells in a flow because someone assigned it there
    (sdd/sales-flows-rediseno slice 4, R6). Unassigned means unassigned: it
    sells nowhere, rather than everywhere. Stock is unaffected — it lives on
    the product, and flows sharing a product share its stock.

    One lightweight query against `flow_products`, not a correlated subquery
    against `Products` — this lets purchase-path callers run the check with
    just the requested IDs, before any `Products` row is loaded.
    """
    from app.api.sales_flow.models import FlowProducts

    if not product_ids:
        return set()

    unique_ids = set(product_ids)
    rows = session.exec(
        select(FlowProducts.product_id).where(
            FlowProducts.flow_id == flow_id,
            FlowProducts.product_id.in_(unique_ids),  # type: ignore[attr-defined]
        )
    ).all()
    return set(rows)


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

    allowed_ids = _flow_allowed_product_ids(session, flow.id, product_ids)
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
    flow, not individual products); assignment filters per-product."""
    if not _restriction_passes(flow, context):
        return []

    allowed_ids = _flow_allowed_product_ids(session, flow.id, [p.id for p in products])
    return [p for p in products if p.id in allowed_ids]
