"""Tests for POST /checkout/{slug}/preview."""

from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlmodel import Session

from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import _make_popup, _make_product


@pytest.fixture(autouse=True)
def disable_preview_rate_limit() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def test_preview_request_requires_products() -> None:
    from app.api.checkout.schemas import CheckoutPreviewRequest

    with pytest.raises(ValueError):
        CheckoutPreviewRequest(products=[])


def test_preview_open_ticketing_computes_breakdown(
    db: Session,
    tenant_a: Tenants,
) -> None:
    from app.api.checkout.schemas import CheckoutPreviewRequest
    from app.api.payment.crud import payments_crud

    popup = _make_popup(db, tenant_a, slug_prefix="prev")
    product = _make_product(db, popup, price="120.00")
    db.commit()

    obj = CheckoutPreviewRequest(
        products=[{"product_id": str(product.id), "quantity": 2}]
    )
    result = payments_crud.preview_open_ticketing(db, obj, popup)

    assert result.total == Decimal("240.00")
    assert result.post_discount_amount == Decimal("240.00")
    assert result.currency == "USD"
    assert len(result.lines) == 1
    assert result.lines[0].discountable is True
