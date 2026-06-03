"""Regression: setting a cap on a previously-unlimited product must count real
sales from payment_products, not silently seed remaining=cap.

Reproduces the bug where a Conference T-Shirt with cap=NULL had 1 unit sold,
then admin set cap=1, and remaining was seeded to 1 — letting a second buyer
exceed the cap.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.crud import products_crud
from app.api.product.models import Products
from app.api.product.schemas import ProductUpdate
from app.api.tenant.models import Tenants


def _make_unlimited_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    suffix = uuid.uuid4().hex[:8]
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"unlimited-{suffix}",
        slug=f"unlimited-{suffix}",
        price=Decimal("35"),
        category="merch",
        total_stock_cap=None,
        total_stock_remaining=None,
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

    Mirrors the helpers in tests/api/payment/test_stock_restoration.py — kept
    self-contained here so this regression test doesn't cross-import.
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


def test_setting_cap_on_unlimited_product_counts_real_sales(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """cap=NULL with 1 APPROVED sale → PATCH cap=1 → remaining=0 (sold preserved)."""
    product = _make_unlimited_product(db, tenant_a, popup_tenant_a)
    _record_sale(db, tenant_a, popup_tenant_a, product, qty=1)

    products_crud.update(db, product, ProductUpdate(total_stock_cap=1))

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.total_stock_cap == 1
    assert refreshed.total_stock_remaining == 0, (
        "Expected remaining=0 because 1 unit was already sold while the "
        "product was unlimited. Got "
        f"{refreshed.total_stock_remaining} — sold count was silently dropped."
    )


def test_setting_cap_on_unlimited_product_counts_pending_sales(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Pending payments hold stock too — they must count toward sold."""
    product = _make_unlimited_product(db, tenant_a, popup_tenant_a)
    _record_sale(
        db, tenant_a, popup_tenant_a, product, qty=2, status=PaymentStatus.PENDING
    )

    products_crud.update(db, product, ProductUpdate(total_stock_cap=5))

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.total_stock_remaining == 3, (
        "Pending sales hold stock until the payment expires — they must be "
        "counted when seeding remaining from a fresh cap."
    )


def test_setting_cap_excludes_cancelled_and_expired_sales(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Cancelled / expired / rejected payments released stock — must NOT count."""
    product = _make_unlimited_product(db, tenant_a, popup_tenant_a)
    _record_sale(
        db, tenant_a, popup_tenant_a, product, qty=1, status=PaymentStatus.CANCELLED
    )
    _record_sale(
        db, tenant_a, popup_tenant_a, product, qty=1, status=PaymentStatus.EXPIRED
    )
    _record_sale(
        db, tenant_a, popup_tenant_a, product, qty=1, status=PaymentStatus.REJECTED
    )

    products_crud.update(db, product, ProductUpdate(total_stock_cap=5))

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.total_stock_remaining == 5, (
        "Released payments must not count as sold. Got "
        f"{refreshed.total_stock_remaining}."
    )


def test_setting_cap_below_real_sold_clamps_to_zero(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """If sold > new_cap (admin underprovisioned), remaining clamps to 0."""
    product = _make_unlimited_product(db, tenant_a, popup_tenant_a)
    _record_sale(db, tenant_a, popup_tenant_a, product, qty=10)

    products_crud.update(db, product, ProductUpdate(total_stock_cap=3))

    db.expire_all()
    refreshed = db.get(Products, product.id)
    assert refreshed.total_stock_cap == 3
    assert refreshed.total_stock_remaining == 0


def test_api_patch_cap_on_unlimited_with_sales(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """End-to-end: PATCH via admin endpoint also counts real sales."""
    product = _make_unlimited_product(db, tenant_a, popup_tenant_a)
    _record_sale(db, tenant_a, popup_tenant_a, product, qty=1)

    resp = client.patch(
        f"/api/v1/products/{product.id}",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"total_stock_cap": 1},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_stock_cap"] == 1
    assert data["total_stock_remaining"] == 0
