"""Shared flow gate and quote authority for checkout preview and purchase."""

import hashlib
import json
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import jwt
from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.checkout.schemas import CheckoutPreviewLine, CheckoutPreviewResponse
from app.api.form_field.crud import form_fields_crud
from app.api.product.models import Products
from app.api.product.product_state import ProductSaleState, derive_product_state
from app.api.product.schemas import ProductPublic
from app.api.sales_flow.eligibility import (
    assert_application_flow_eligible,
    assert_upsale_eligible,
)
from app.api.sales_flow.schemas import SalesFlowType, SelectedSalesFlow
from app.core.config import settings
from app.core.security import ALGORITHM
from app.services.restrictions.context import build_context
from app.services.restrictions.enforcement import assert_products_allowed

if TYPE_CHECKING:
    from app.api.checkout.schemas import BuyerInfo, ProductLine
    from app.api.human.schemas import HumanPublic
    from app.api.popup.models import Popups
    from app.api.sales_flow.models import SalesFlows

QUOTE_TTL = timedelta(minutes=5)


@dataclass(frozen=True)
class GateQuote:
    products: list[Products]
    amounts: Any
    response: CheckoutPreviewResponse
    fingerprint: str


def selected_flow(flow: "SalesFlows") -> SelectedSalesFlow:
    return SelectedSalesFlow.model_validate(flow, from_attributes=True)


def resolve_checkout_flow(
    session: Session,
    popup: "Popups",
    flow_slug: str,
    *,
    require_types: Iterable[SalesFlowType] | None = None,
) -> "SalesFlows":
    from app.api.sales_flow.resolver import resolve_flow

    try:
        return resolve_flow(session, popup, flow_slug, require_types=require_types)
    except HTTPException as exc:
        if exc.status_code != status.HTTP_404_NOT_FOUND:
            raise
        raise HTTPException(status_code=exc.status_code, detail="Not found") from exc


def _unavailable(status_code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> None:
    raise HTTPException(status_code=status_code, detail={"code": "quote_unavailable"})


def _fingerprint(
    popup: "Popups",
    flow: "SalesFlows",
    lines: list["ProductLine"],
    products: list[Products],
    buyer: "BuyerInfo | None",
    human: "HumanPublic | None",
    amounts: Any,
) -> str:
    state = {
        "popup_id": popup.id,
        "flow_id": flow.id,
        "flow_updated_at": flow.updated_at,
        "human_id": human.id if human else None,
        "buyer": buyer.model_dump(mode="json") if buyer else None,
        "lines": [line.model_dump(mode="json") for line in lines],
        "products": [
            {
                "id": product.id,
                "price": product.price,
                "active": product.is_active,
                "starts": product.sale_starts_at,
                "ends": product.sale_ends_at,
                "stock": product.total_stock_remaining,
                "cap": product.max_per_order,
                "sold_out": product.sold_out_override,
            }
            for product in sorted(products, key=lambda item: str(item.id))
        ],
        "total": amounts.total_amount,
        "coupon": amounts.coupon_code,
        "discount": amounts.discount_amount,
        "insurance": amounts.insurance_amount,
        "contribution": amounts.contribution_amount,
    }
    raw = json.dumps(state, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _quote_token(
    fingerprint: str, popup_id: uuid.UUID, flow_id: uuid.UUID
) -> tuple[str, datetime]:
    expires_at = datetime.now(UTC) + QUOTE_TTL
    token = jwt.encode(
        {
            "typ": "checkout_quote",
            "fingerprint": fingerprint,
            "popup_id": str(popup_id),
            "flow_id": str(flow_id),
            "exp": expires_at,
        },
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return token, expires_at


def evaluate_gate_quote(
    session: Session,
    popup: "Popups",
    flow: "SalesFlows",
    lines: list["ProductLine"],
    *,
    coupon_code: str | None,
    insurance: bool,
    buyer: "BuyerInfo | None",
    current_human: "HumanPublic | None",
    lock_products: bool = False,
    require_complete: bool = False,
) -> GateQuote:
    """Evaluate every mutable checkout rule once and produce one quote."""
    assert_upsale_eligible(session, flow, popup.id, popup.tenant_id, current_human)
    assert_application_flow_eligible(session, flow, popup.tenant_id, current_human)
    context = build_context(
        session,
        popup,
        flow,
        human=current_human,
        buyer_form_data=buyer.form_data if buyer else None,
        buyer_email=buyer.email if buyer else None,
    )
    product_ids = [line.product_id for line in lines]
    assert_products_allowed(session, flow, popup, product_ids, context)

    statement = select(Products).where(
        Products.id.in_(product_ids),  # type: ignore[attr-defined]
        Products.popup_id == popup.id,
        Products.is_active == True,  # noqa: E712
        Products.deleted_at.is_(None),  # type: ignore[attr-defined]
    )
    if lock_products:
        statement = statement.with_for_update()
    products = list(session.exec(statement).all())
    if {product.id for product in products} != set(product_ids):
        _unavailable()

    quantities: dict[uuid.UUID, int] = {}
    for line in lines:
        quantities[line.product_id] = quantities.get(line.product_id, 0) + line.quantity
    for product in products:
        quantity = quantities[product.id]
        if (
            derive_product_state(ProductPublic.model_validate(product))
            != ProductSaleState.on_sale
        ):
            _unavailable()
        if product.max_per_order is not None and quantity > product.max_per_order:
            _unavailable()
        if (
            product.total_stock_remaining is not None
            and quantity > product.total_stock_remaining
        ):
            _unavailable(status.HTTP_409_CONFLICT)

    fields, _ = form_fields_crud.find_by_flow(session, flow.id, limit=1000)
    allowed_fields = {field.name for field in fields}
    form_data = buyer.form_data if buyer else {}
    if set(form_data) - allowed_fields:
        _unavailable()
    complete = buyer is not None and all(
        form_data.get(field.name) not in (None, "", [])
        for field in fields
        if field.required
    )
    if require_complete and not complete:
        _unavailable()

    from app.api.payment.crud import compute_open_ticketing_amounts

    products_map = {product.id: product for product in products}
    amounts = compute_open_ticketing_amounts(
        session,
        popup,
        flow,
        products_map,
        lines,
        coupon_code=coupon_code,
        insurance=insurance,
    )
    fingerprint = _fingerprint(
        popup, flow, lines, products, buyer, current_human, amounts
    )
    token, expires_at = (
        _quote_token(fingerprint, popup.id, flow.id) if complete else (None, None)
    )
    response = CheckoutPreviewResponse(
        lines=[CheckoutPreviewLine(**vars(line)) for line in amounts.lines],
        discountable_amount=amounts.discountable_amount,
        non_discountable_amount=amounts.non_discountable_amount,
        coupon_code=amounts.coupon_code,
        discount_value=amounts.discount_value,
        discount_amount=amounts.discount_amount,
        post_discount_amount=amounts.post_discount_amount,
        insurance_amount=amounts.insurance_amount,
        contribution_amount=amounts.contribution_amount,
        total=amounts.total_amount,
        currency=amounts.currency,
        selected_flow=selected_flow(flow),
        kind="definitive" if complete else "estimate",
        quote_token=token,
        quote_expires_at=expires_at,
    )
    return GateQuote(products, amounts, response, fingerprint)


def assert_quote_current(token: str, gate: GateQuote) -> None:
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        current = (
            claims.get("typ") == "checkout_quote"
            and claims.get("fingerprint") == gate.fingerprint
        )
    except jwt.InvalidTokenError:
        current = False
    if not current:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "requote_required",
                "fresh_quote": gate.response.model_dump(mode="json"),
            },
        )
