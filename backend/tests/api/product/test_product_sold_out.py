"""Manual sold-out override — POST /products/{id}/sold-out.

The override is an explicit flag (`sold_out_override`); the stock counter
is never touched. This keeps `total_stock_remaining` truthful so the
restore-on-expiry and cap-recompute flows cannot silently un-mark the
product or poison the sold derivation.
"""

import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.product.product_state import ProductSaleState, derive_product_state
from app.api.product.schemas import ProductUpdate
from app.api.tenant.models import Tenants


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    total_stock_cap: int | None,
    total_stock_remaining: int | None,
) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"soldout-{suffix}",
        slug=f"soldout-{suffix}",
        price=Decimal("35"),
        category="merch",
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_remaining,
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _record_sale(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    product: Products,
    qty: int,
    status: PaymentStatus = PaymentStatus.APPROVED,
) -> Payments:
    """Create a payment + payment_products snapshot mimicking a real sale.

    Mirrors the helpers in tests/api/product/test_cap_seed_from_real_sales.py —
    kept self-contained here so this test doesn't cross-import.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.attendee.models import Attendees
    from app.api.human.models import Humans

    human = Humans(
        tenant_id=tenant.id,
        email=f"sale-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Sale",
        last_name="Test",
    )
    db.add(human)
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        name="Sale Attendee",
        category="main",
        email=f"att-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=status.value,
        amount=Decimal(str(product.price * qty)),
        currency="ARS",
        external_id=f"sf-{uuid.uuid4().hex[:16]}",
    )
    db.add(payment)
    db.flush()

    pp = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=qty,
        product_name=product.name,
        product_description=None,
        product_price=product.price,
        product_category=product.category or "merch",
        product_currency="ARS",
    )
    db.add(pp)
    db.commit()
    db.refresh(payment)
    return payment


def _set_sold_out(
    client: TestClient, token: str, product_id: uuid.UUID, sold_out: bool
) -> dict:
    resp = client.post(
        f"/api/v1/products/{product_id}/sold-out",
        headers={"Authorization": f"Bearer {token}"},
        json={"sold_out": sold_out},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_mark_sold_out_with_cap_sets_flag_and_keeps_counter(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """cap=10, remaining=10 → mark → flag on, state sold_out, counter untouched."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10
    )

    data = _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)
    assert data["sold_out_override"] is True
    assert data["total_stock_remaining"] == 10
    assert data["total_stock_cap"] == 10

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.sold_out_override is True
    assert refreshed.total_stock_remaining == 10
    assert derive_product_state(refreshed) == ProductSaleState.sold_out


def test_mark_sold_out_with_null_cap_sets_flag_and_keeps_unlimited(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """cap=NULL (unlimited) → mark → flag on, state sold_out, remaining stays NULL."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None
    )

    data = _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)
    assert data["sold_out_override"] is True
    assert data["total_stock_remaining"] is None

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.sold_out_override is True
    assert refreshed.total_stock_remaining is None
    assert derive_product_state(refreshed) == ProductSaleState.sold_out


def test_unmark_clears_flag_and_keeps_counter(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Unmark → flag off, remaining unchanged, state back to on_sale."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=7, total_stock_remaining=5
    )
    _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)

    data = _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=False)
    assert data["sold_out_override"] is False
    assert data["total_stock_remaining"] == 5

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.sold_out_override is False
    assert refreshed.total_stock_remaining == 5
    assert derive_product_state(refreshed) == ProductSaleState.on_sale


def test_restore_after_expiry_keeps_product_sold_out(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Regression (the blocker): restoring stock must not un-mark the product.

    A pending payment holds 3 units (remaining 7 of 10). Admin marks the
    product sold out, then the payment expires and `restore_total_stock`
    runs. The counter goes back up (stays truthful) but the derived state
    remains sold_out because the override is independent of the counter.
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=7
    )
    _record_sale(
        db, tenant_a, popup_tenant_a, product, qty=3, status=PaymentStatus.PENDING
    )

    _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)

    # What the payment expiry/cancel flow calls to release the held units.
    products_crud.restore_total_stock(db, product.id, quantity=3)
    db.commit()

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.total_stock_remaining == 10  # counter truthful
    assert refreshed.sold_out_override is True
    assert derive_product_state(refreshed) == ProductSaleState.sold_out


def test_cap_update_while_overridden_preserves_sold_derivation(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Regression (the critical): the override must not poison cap recomputes.

    With 3 units sold (remaining 7 of 10), marking sold out leaves the
    counter alone, so a later cap edit to 20 derives sold = 10 - 7 = 3 and
    sets remaining = 17. The old design forced remaining to 0, over-counting
    sold as 10 and under-crediting inventory (remaining would be 10).
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=7
    )
    _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)

    db.expire_all()
    refreshed = db.get(Products, product.id)
    updated = products_crud.update(db, refreshed, ProductUpdate(total_stock_cap=20))

    assert updated.total_stock_cap == 20
    assert updated.total_stock_remaining == 17
    assert updated.sold_out_override is True
    assert derive_product_state(updated) == ProductSaleState.sold_out


def test_decrement_rejects_overridden_capped_product_with_stock(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Purchase enforcement: override blocks checkout even with remaining stock.

    The application purchase path only gates upcoming/ended in
    `_validate_products` and relies on `decrement_total_stock` for the
    sold-out 409, so the guard must live there.
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10
    )
    _set_sold_out(client, admin_token_tenant_a, product.id, sold_out=True)

    db.expire_all()
    with pytest.raises(HTTPException) as exc_info:
        products_crud.decrement_total_stock(db, product.id, quantity=1)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == f"'{product.name}' is sold out"
    db.rollback()


def test_decrement_rejects_overridden_unlimited_product(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Override guards unlimited (NULL counter) products too.

    Without the guard they skip the decrement entirely via the NULL
    fast path, so the override would never be enforced at purchase time.
    """
    unlimited = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=None, total_stock_remaining=None
    )
    _set_sold_out(client, admin_token_tenant_a, unlimited.id, sold_out=True)

    db.expire_all()
    with pytest.raises(HTTPException) as exc_info:
        products_crud.decrement_total_stock(db, unlimited.id, quantity=1)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == f"'{unlimited.name}' is sold out"
    db.rollback()


def test_viewer_cannot_set_sold_out(
    client: TestClient,
    db: Session,
    viewer_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """VIEWER role cannot flip the override (POST returns 403)."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10
    )

    resp = client.post(
        f"/api/v1/products/{product.id}/sold-out",
        headers={"Authorization": f"Bearer {viewer_token_tenant_a}"},
        json={"sold_out": True},
    )
    assert resp.status_code == 403, resp.text

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.sold_out_override is False


def test_cross_tenant_admin_cannot_set_sold_out(
    client: TestClient,
    db: Session,
    admin_token_tenant_b: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Tenant B admin cannot flip the override on Tenant A's product.

    RLS filters the product out of tenant B's session, so the endpoint
    reports 404 (not found) rather than 403.
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, total_stock_cap=10, total_stock_remaining=10
    )

    resp = client.post(
        f"/api/v1/products/{product.id}/sold-out",
        headers={"Authorization": f"Bearer {admin_token_tenant_b}"},
        json={"sold_out": True},
    )
    assert resp.status_code == 404, resp.text

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.sold_out_override is False


def test_sold_out_unknown_product_returns_404(
    client: TestClient,
    admin_token_tenant_a: str,
) -> None:
    """Unknown product id → 404 Product not found."""
    resp = client.post(
        f"/api/v1/products/{uuid.uuid4()}/sold-out",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"sold_out": True},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Product not found"
