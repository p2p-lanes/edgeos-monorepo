"""Fixtures for the accommodation domain tests.

Builds a small real inventory (one property, one room type, N units) on the
shared test popup, so every test exercises the actual tables, including the
exclusion constraint, which is the whole point of this module.
"""

import uuid
from collections.abc import Callable
from datetime import date
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.api.accommodation.crud import (
    accommodation_properties_crud,
    accommodation_units_crud,
    accommodations_crud,
)
from app.api.accommodation.models import AccommodationProperties, Accommodations
from app.api.accommodation.schemas import (
    AccommodationCreate,
    AccommodationPropertyCreate,
    AccommodationUnitBulkCreate,
)
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# Any window works; a fixed one keeps failures readable.
BOOKABLE_FROM = date(2026, 6, 1)
BOOKABLE_TO = date(2026, 7, 31)


@pytest.fixture
def accommodation_property(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> AccommodationProperties:
    return accommodation_properties_crud.create_for_tenant(
        db,
        AccommodationPropertyCreate(
            popup_id=popup_tenant_a.id,
            name=f"Hotel {uuid.uuid4().hex[:8]}",
            tax_percentage=None,
        ),
        tenant_a.id,
    )


@pytest.fixture
def make_accommodation(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> Callable[..., Accommodations]:
    """Factory: a room type with ``units`` units, ready to book."""

    def _make(
        property_row: AccommodationProperties,
        *,
        units: int = 2,
        nightly: str = "100",
        long_stay_price: str | None = None,
        min_stay_override: int | None = None,
        guest_capacity: int = 2,
        bookable_from: date = BOOKABLE_FROM,
        bookable_to: date = BOOKABLE_TO,
    ) -> Accommodations:
        accommodation = accommodations_crud.create_for_tenant(
            db,
            AccommodationCreate(
                popup_id=popup_tenant_a.id,
                property_id=property_row.id,
                name=f"Room {uuid.uuid4().hex[:8]}",
                guest_capacity=guest_capacity,
                default_nightly_price=Decimal(nightly),
                long_stay_price=(
                    Decimal(long_stay_price) if long_stay_price is not None else None
                ),
                min_stay_override=min_stay_override,
                bookable_from=bookable_from,
                bookable_to=bookable_to,
            ),
            tenant_a.id,
        )
        if units:
            accommodation_units_crud.bulk_create(
                db,
                accommodation,
                AccommodationUnitBulkCreate(prefix="U", count=units),
            )
            db.refresh(accommodation)
        return accommodation

    return _make
