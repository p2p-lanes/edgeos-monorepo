"""Tests for AttendeeProductPublic snapshot lookup in _build_attendee_with_origin.

product_name and product_category prefer the at-purchase snapshot stored in
payment_products (matched on (payment_id, product_id)) so a rename or
recategorization after the purchase does not retroactively rewrite a buyer's
pass. Falls back to the live product when the attendee has no payment_id or
no matching snapshot row exists.

Scenarios:
1. Snapshot present → response uses snapshot name/category, not live product.
2. payment_id is None on the ticket (free / application grant) → fallback to live product.
3. payment_id set but no matching snapshot row → fallback to live product.
4. Product was renamed and recategorized after purchase → snapshot wins.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.router import _build_attendee_with_origin
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    name: str,
    category: str = "ticket",
    requires_check_in: bool = True,
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name,
        slug=f"snap-{uuid.uuid4().hex[:8]}",
        price=Decimal("100"),
        category=category,
        requires_check_in=requires_check_in,
        is_active=True,
        duration_type="week",
        start_date=start_date,
        end_date=end_date,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"snap-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_attendee(
    db: Session, tenant: Tenants, popup: Popups, human: Humans, *, suffix: str
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name=f"Snap Attendee {suffix}",
        category="main",
        check_in_code=None,
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_payment(
    db: Session, tenant: Tenants, popup: Popups, *, status: str = PaymentStatus.APPROVED.value
) -> Payments:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        status=status,
        amount=Decimal("100"),
        currency="USD",
        payment_type=PaymentType.PASS_PURCHASE.value,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
    *,
    payment_id: uuid.UUID | None,
    suffix: str,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"SNAP{suffix[:4].upper()}{uuid.uuid4().hex[:4].upper()}",
        payment_id=payment_id,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def _make_payment_product(
    db: Session,
    tenant: Tenants,
    payment: Payments,
    product: Products,
    attendee: Attendees,
    *,
    snapshot_name: str,
    snapshot_category: str,
) -> PaymentProducts:
    pp = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        product_name=snapshot_name,
        product_description=None,
        product_price=Decimal("100"),
        product_category=snapshot_category,
        product_currency="USD",
    )
    db.add(pp)
    db.commit()
    db.refresh(pp)
    return pp


def _load_attendee_with_relations(db: Session, attendee_id: uuid.UUID) -> Attendees:
    """Eager-load the same relations the production CRUD path loads."""
    stmt = (
        select(Attendees)
        .where(Attendees.id == attendee_id)
        .options(
            selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                AttendeeProducts.product  # ty: ignore[invalid-argument-type]
            ),
            selectinload(Attendees.payment_products),  # type: ignore[arg-type]
        )
    )
    return db.exec(stmt).one()


# ---------------------------------------------------------------------------
# Scenario 1: Snapshot present → response uses snapshot fields
# ---------------------------------------------------------------------------


def test_snapshot_overrides_live_product(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """When a payment_products snapshot row exists, response uses snapshot name/category."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, name="Live Product Name", category="ticket"
    )
    human = _make_human(db, tenant_a, suffix="s1")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="s1")
    payment = _make_payment(db, tenant_a, popup_tenant_a)
    _make_payment_product(
        db,
        tenant_a,
        payment,
        product,
        attendee,
        snapshot_name="Snapshotted Pass",
        snapshot_category="patreon",
    )
    _make_ticket(
        db, tenant_a, attendee, product, payment_id=payment.id, suffix="s1"
    )

    loaded = _load_attendee_with_relations(db, attendee.id)
    result = _build_attendee_with_origin(loaded)

    assert len(result.products) == 1
    ap = result.products[0]
    assert ap.product_name == "Snapshotted Pass"
    assert ap.product_category == "patreon"


# ---------------------------------------------------------------------------
# Scenario 2: payment_id is None → fallback to live product
# ---------------------------------------------------------------------------


def test_no_payment_id_falls_back_to_live_product(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """A free / application-grant ticket has payment_id=None → live product wins."""
    product = _make_product(
        db, tenant_a, popup_tenant_a, name="Live Free Pass", category="ticket"
    )
    human = _make_human(db, tenant_a, suffix="s2")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="s2")
    _make_ticket(
        db, tenant_a, attendee, product, payment_id=None, suffix="s2"
    )

    loaded = _load_attendee_with_relations(db, attendee.id)
    result = _build_attendee_with_origin(loaded)

    assert len(result.products) == 1
    ap = result.products[0]
    assert ap.payment_id is None
    assert ap.product_name == "Live Free Pass"
    assert ap.product_category == "ticket"


# ---------------------------------------------------------------------------
# Scenario 3: payment_id set but no matching snapshot row → fallback
# ---------------------------------------------------------------------------


def test_missing_snapshot_falls_back_to_live_product(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Ticket has payment_id but no payment_products row matches → live product wins.

    Models the cancelled / refunded payment whose snapshot rows were cascaded
    away while the AttendeeProducts row survived.
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, name="Live Cancelled Pass", category="ticket"
    )
    human = _make_human(db, tenant_a, suffix="s3")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="s3")
    payment = _make_payment(
        db, tenant_a, popup_tenant_a, status=PaymentStatus.CANCELLED.value
    )
    # Intentionally no _make_payment_product → no snapshot row for this triple.
    _make_ticket(
        db, tenant_a, attendee, product, payment_id=payment.id, suffix="s3"
    )

    loaded = _load_attendee_with_relations(db, attendee.id)
    result = _build_attendee_with_origin(loaded)

    assert len(result.products) == 1
    ap = result.products[0]
    assert ap.payment_id == payment.id
    assert ap.product_name == "Live Cancelled Pass"
    assert ap.product_category == "ticket"


# ---------------------------------------------------------------------------
# Scenario 4: Product renamed/recategorized after purchase → snapshot wins
# ---------------------------------------------------------------------------


def test_product_renamed_after_purchase_snapshot_wins(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """The product is renamed and recategorized after the snapshot is taken.

    The buyer's pass must keep the original (snapshotted) name and category —
    that is the entire point of capturing the snapshot at purchase time.
    """
    product = _make_product(
        db, tenant_a, popup_tenant_a, name="Original Pass", category="ticket"
    )
    human = _make_human(db, tenant_a, suffix="s4")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="s4")
    payment = _make_payment(db, tenant_a, popup_tenant_a)
    _make_payment_product(
        db,
        tenant_a,
        payment,
        product,
        attendee,
        snapshot_name="Original Pass",
        snapshot_category="ticket",
    )
    _make_ticket(
        db, tenant_a, attendee, product, payment_id=payment.id, suffix="s4"
    )

    # Operator edits the product after the sale.
    product.name = "Renamed Pass v2"
    product.category = "patreon"
    db.add(product)
    db.commit()

    loaded = _load_attendee_with_relations(db, attendee.id)
    result = _build_attendee_with_origin(loaded)

    assert len(result.products) == 1
    ap = result.products[0]
    assert ap.product_name == "Original Pass"
    assert ap.product_category == "ticket"
