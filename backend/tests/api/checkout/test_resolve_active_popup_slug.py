"""Unit tests for resolve_active_direct_popup_slug (Task 5.1 / Task 2.1).

Which gathering a tenant's bare `/checkout` lands on. The question used to be
asked of `popup.sale_type` and is asked of the DEFAULT flow's type now
(sdd/sales-flows-rediseno slice 6).

Covers scenarios:
- C-1: single active gathering whose main way in sells → returns its slug
- C-2: multiple active popups, start_date tiebreak → earliest wins
- C-3: multiple active popups, id tiebreak when start_date null for both
- C-4: no active popup → returns None
- C-5: a gathering people apply to → returns None (excluded)
- C-6: a gathering people apply to that also has a selling door → still
  excluded, and does not steal the landing from the real storefront
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlmodel import Session

from app.api.checkout.crud import resolve_active_direct_popup_slug
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


@pytest.fixture()
def tenant(db: Session) -> Tenants:
    t = Tenants(
        name=f"Resolver Tenant {uuid.uuid4().hex[:6]}",
        slug=f"resolver-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _popup(
    db: Session,
    tenant: Tenants,
    *,
    slug: str,
    status: PopupStatus = PopupStatus.active,
    sale_type: SaleType = SaleType.direct,
    start_date: datetime | None = None,
) -> Popups:
    p = Popups(
        name=f"Popup {slug}",
        slug=slug,
        tenant_id=tenant.id,
        status=status,
        sale_type=sale_type,
        start_date=start_date,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    # A popup built straight into the session skips PopupsCRUD.create, and the
    # resolver now joins the default flow. Without this the row is invisible.
    provision_default_flow(db, p, sale_type=sale_type.value)
    db.commit()
    return p


# C-1: single active direct popup
def test_single_active_direct_popup_returns_slug(db: Session, tenant: Tenants) -> None:
    p = _popup(db, tenant, slug=f"c1-{uuid.uuid4().hex[:6]}")
    result = resolve_active_direct_popup_slug(db, tenant.id)
    assert result == p.slug


# C-4: no active popup → None (no exception)
def test_no_active_popup_returns_none(db: Session) -> None:
    t = Tenants(
        name=f"No Popup Tenant {uuid.uuid4().hex[:6]}",
        slug=f"no-popup-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    result = resolve_active_direct_popup_slug(db, t.id)
    assert result is None


# C-5: application sale_type is excluded
def test_application_sale_type_excluded(db: Session) -> None:
    # Use a fresh tenant to avoid interference from C-1 popup
    t = Tenants(
        name=f"App Only Tenant {uuid.uuid4().hex[:6]}",
        slug=f"app-only-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    _popup(db, t, slug=f"c5-{uuid.uuid4().hex[:6]}", sale_type=SaleType.application)
    result = resolve_active_direct_popup_slug(db, t.id)
    assert result is None


# C-6: a conference with a sponsor's door is not the tenant's storefront
def test_a_selling_door_does_not_make_a_gathering_the_storefront(db: Session) -> None:
    """The reason this matches the DEFAULT flow rather than any flow.

    A conference people apply to, starting earlier than the tenant's actual
    shop, with one door that sells to sponsors. Matching "has a door that
    sells" would hand it the bare `/checkout` on start_date order, and every
    stranger following the tenant's checkout link would land on a conference
    they cannot buy into.
    """
    t = Tenants(
        name=f"Mixed Tenant {uuid.uuid4().hex[:6]}",
        slug=f"mixed-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    conference = _popup(
        db,
        t,
        slug=f"c6-conference-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application,
        start_date=datetime(2026, 6, 1, tzinfo=UTC),
    )
    db.add(
        SalesFlows(
            tenant_id=t.id,
            popup_id=conference.id,
            slug=f"sponsors-{uuid.uuid4().hex[:6]}",
            name="Sponsors",
            type=SaleType.direct.value,
        )
    )
    db.commit()

    shop_slug = f"c6-shop-{uuid.uuid4().hex[:6]}"
    _popup(db, t, slug=shop_slug, start_date=datetime(2026, 7, 1, tzinfo=UTC))

    assert resolve_active_direct_popup_slug(db, t.id) == shop_slug


# C-2: start_date tiebreak — earliest wins
def test_start_date_tiebreak_earliest_wins(db: Session) -> None:
    t = Tenants(
        name=f"Tiebreak Date Tenant {uuid.uuid4().hex[:6]}",
        slug=f"tiebreak-date-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    earlier = datetime(2026, 6, 1, tzinfo=UTC)
    later = datetime(2026, 7, 1, tzinfo=UTC)

    slug_a = f"c2-a-{uuid.uuid4().hex[:6]}"
    slug_b = f"c2-b-{uuid.uuid4().hex[:6]}"
    _popup(db, t, slug=slug_a, start_date=earlier)
    _popup(db, t, slug=slug_b, start_date=later)

    result = resolve_active_direct_popup_slug(db, t.id)
    assert result == slug_a


# C-3: id tiebreak when start_date is null for both
def test_id_tiebreak_when_both_start_date_null(db: Session) -> None:
    t = Tenants(
        name=f"Tiebreak ID Tenant {uuid.uuid4().hex[:6]}",
        slug=f"tiebreak-id-tenant-{uuid.uuid4().hex[:6]}",
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    # Create two popups with no start_date; first inserted will have lower UUID
    # (UUIDs are random, so we capture both and compare)
    slug_x = f"c3-x-{uuid.uuid4().hex[:6]}"
    slug_y = f"c3-y-{uuid.uuid4().hex[:6]}"
    popup_x = _popup(db, t, slug=slug_x, start_date=None)
    popup_y = _popup(db, t, slug=slug_y, start_date=None)

    result = resolve_active_direct_popup_slug(db, t.id)

    # The one with the lexicographically smaller UUID wins
    lower_id_slug = slug_x if str(popup_x.id) < str(popup_y.id) else slug_y
    assert result == lower_id_slug
