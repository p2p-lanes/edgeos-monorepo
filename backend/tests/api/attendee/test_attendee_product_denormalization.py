"""Tests for AttendeeProductPublic denormalization of product fields.

T3.1 — Three scenarios:
1. Active product → all 5 fields populated.
2. Deactivated product (is_active=False) → still populated (deactivation doesn't suppress denorm).
3. Null product guard → fields are None, no AttributeError.

T2.8a — Schema guard scenarios (no DB required):
4. Constructing AttendeeProductPublic with start_date raises ValidationError (extra="forbid").
5. Constructing AttendeeProductPublic with end_date raises ValidationError (extra="forbid").
6. Constructing AttendeeProductPublic with duration_type="multi_day" succeeds.
"""

import uuid
from datetime import UTC
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.router import _build_attendee_with_origin
from app.api.attendee.schemas import AttendeeProductPublic
from app.api.human.models import Humans
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
    suffix: str,
    is_active: bool = True,
    category: str = "ticket",
    requires_check_in: bool = True,
    duration_type: str | None = "week",
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Denorm Product {suffix}",
        slug=f"denorm-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
        category=category,
        requires_check_in=requires_check_in,
        is_active=is_active,
        duration_type=duration_type,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"denorm-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
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
        name=f"Denorm Attendee {suffix}",
        category="main",
        check_in_code=None,
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session,
    tenant: Tenants,
    attendee: Attendees,
    product: Products,
    *,
    suffix: str,
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"DNRM{suffix[:4].upper()}{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# Scenario 1: Active product — all 5 fields populated
# ---------------------------------------------------------------------------


def test_denorm_active_product_populates_all_fields(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Active product → denormalized fields are populated in the response."""
    product = _make_product(
        db,
        tenant_a,
        popup_tenant_a,
        suffix="active",
        category="ticket",
        requires_check_in=True,
        duration_type="week",
    )
    human = _make_human(db, tenant_a, suffix="active")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="active")
    _make_ticket(db, tenant_a, attendee, product, suffix="active")

    # Re-fetch attendee with eager load via the CRUD path used by the router
    from sqlalchemy.orm import selectinload
    from sqlmodel import select

    from app.api.attendee.models import AttendeeProducts as AP

    stmt = (
        select(Attendees)
        .where(Attendees.id == attendee.id)
        .options(
            selectinload(Attendees.attendee_products).selectinload(AP.product)  # type: ignore[arg-type]
        )
    )
    loaded = db.exec(stmt).one()

    result = _build_attendee_with_origin(loaded)
    assert len(result.products) == 1

    ap = result.products[0]
    assert ap.product_name == "Denorm Product active"
    assert ap.product_category == "ticket"
    assert ap.duration_type == "week"
    assert ap.requires_check_in is True


# ---------------------------------------------------------------------------
# Scenario 2: Deactivated product — denorm still populated
# ---------------------------------------------------------------------------


def test_denorm_inactive_product_still_populated(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """Deactivated product (is_active=False) → denormalized fields are still populated.

    Deactivation does not suppress denormalization — the product is still accessible
    via the relationship eager-loaded from attendee_products.
    """
    product = _make_product(
        db,
        tenant_a,
        popup_tenant_a,
        suffix="inactive",
        is_active=False,
        category="housing",
        requires_check_in=False,
        duration_type=None,
    )
    human = _make_human(db, tenant_a, suffix="inactive")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="inactive")
    _make_ticket(db, tenant_a, attendee, product, suffix="inac")

    from sqlalchemy.orm import selectinload
    from sqlmodel import select

    from app.api.attendee.models import AttendeeProducts as AP

    stmt = (
        select(Attendees)
        .where(Attendees.id == attendee.id)
        .options(
            selectinload(Attendees.attendee_products).selectinload(AP.product)  # type: ignore[arg-type]
        )
    )
    loaded = db.exec(stmt).one()

    result = _build_attendee_with_origin(loaded)
    assert len(result.products) == 1

    ap = result.products[0]
    assert ap.product_name == "Denorm Product inactive"
    assert ap.product_category == "housing"
    assert ap.duration_type is None
    assert ap.requires_check_in is False


# ---------------------------------------------------------------------------
# Scenario 3: Null product guard — no AttributeError, all fields None
# ---------------------------------------------------------------------------


def test_denorm_null_product_guard(
    db: Session,
    tenant_a: Tenants,
    popup_tenant_a: Popups,
) -> None:
    """When ap.product is None (orphaned row), denormalized fields default to None.

    The None-guard pattern `(ap.product.name if ap.product else None)` must not
    raise AttributeError.
    """
    human = _make_human(db, tenant_a, suffix="nullprod")
    attendee = _make_attendee(db, tenant_a, popup_tenant_a, human, suffix="nullprod")

    # Manually inject an orphaned AttendeeProducts row using a non-existent product_id.
    # We patch the attendee.attendee_products in-memory to simulate a null product
    # without violating FK constraints in the DB.
    from unittest.mock import MagicMock

    # Build a mock ap whose .product is None
    mock_ap = MagicMock()
    mock_ap.id = uuid.uuid4()
    mock_ap.attendee_id = attendee.id
    mock_ap.product_id = uuid.uuid4()
    mock_ap.check_in_code = "NULLPROD1"
    mock_ap.payment_id = None
    mock_ap.product = None  # simulate unloaded / orphaned relationship
    mock_ap.purchase_metadata = None

    # Patch the ORM relationship on the loaded attendee
    from sqlmodel import select

    stmt = select(Attendees).where(Attendees.id == attendee.id)
    loaded = db.exec(stmt).one()

    # Override attendee_products with the mock list
    loaded.__dict__["attendee_products"] = [mock_ap]

    # Must not raise
    result = _build_attendee_with_origin(loaded)
    assert len(result.products) == 1

    ap = result.products[0]
    assert ap.product_name is None
    assert ap.product_category is None
    assert ap.duration_type is None
    assert ap.requires_check_in is False


# ---------------------------------------------------------------------------
# T2.8a — Schema guard: start_date/end_date removed from AttendeeProductPublic
# ---------------------------------------------------------------------------


_BASE_TICKET_KWARGS = {
    "id": uuid.uuid4(),
    "attendee_id": uuid.uuid4(),
    "product_id": uuid.uuid4(),
    "check_in_code": "TESTCODE01",
}


def test_attendee_product_public_rejects_start_date() -> None:
    """AttendeeProductPublic with start_date raises ValidationError (extra='forbid').

    start_date was removed from AttendeeProductPublic in PR 2. Pydantic must
    reject it so stale callers surface a hard error rather than silently
    ignoring the field.
    """
    from datetime import datetime

    with pytest.raises(ValidationError) as exc_info:
        AttendeeProductPublic(**_BASE_TICKET_KWARGS, start_date=datetime.now(tz=UTC))  # type: ignore[call-arg]
    errors = exc_info.value.errors()
    assert any("start_date" in str(e) for e in errors), (
        f"expected start_date in errors, got: {errors}"
    )


def test_attendee_product_public_rejects_end_date() -> None:
    """AttendeeProductPublic with end_date raises ValidationError (extra='forbid').

    end_date was removed from AttendeeProductPublic in PR 2. Same rationale as
    start_date above.
    """
    from datetime import datetime

    with pytest.raises(ValidationError) as exc_info:
        AttendeeProductPublic(**_BASE_TICKET_KWARGS, end_date=datetime.now(tz=UTC))  # type: ignore[call-arg]
    errors = exc_info.value.errors()
    assert any("end_date" in str(e) for e in errors), (
        f"expected end_date in errors, got: {errors}"
    )


def test_attendee_product_public_accepts_duration_type_multi_day() -> None:
    """AttendeeProductPublic with duration_type='multi_day' succeeds.

    duration_type is a free-form string so 'multi_day' is a valid value.
    This confirms the field remains present and accepts arbitrary string values.
    """
    ap = AttendeeProductPublic(**_BASE_TICKET_KWARGS, duration_type="multi_day")
    assert ap.duration_type == "multi_day"
