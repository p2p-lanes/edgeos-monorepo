"""Tests for AttendeesCRUD.find_by_popup category_id filter.

Each test creates a fresh popup so it is isolated from the session-scoped
shared fixtures (db / tenant_a have no per-test rollback).
"""

import uuid

from sqlmodel import Session

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name="Filters Popup",
        slug=f"filters-popup-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_category(
    db: Session, tenant: Tenants, popup: Popups, key: str
) -> AttendeeCategories:
    cat = AttendeeCategories(
        id=uuid.uuid4(), tenant_id=tenant.id, popup_id=popup.id, key=key
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    name: str,
    category_id: uuid.UUID | None = None,
) -> Attendees:
    att = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name,
        category_id=category_id,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


class TestFindByPopupCategoryFilter:
    def test_category_filter(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        cat_a = _make_category(db, tenant_a, popup, key=f"a-{uuid.uuid4().hex[:6]}")
        cat_b = _make_category(db, tenant_a, popup, key=f"b-{uuid.uuid4().hex[:6]}")
        a = _make_attendee(db, tenant_a, popup, name="A", category_id=cat_a.id)
        _make_attendee(db, tenant_a, popup, name="B", category_id=cat_b.id)

        results, total = attendees_crud.find_by_popup(
            db, popup_id=popup.id, category_id=cat_a.id
        )
        assert total == 1
        assert [r.id for r in results] == [a.id]

    def test_no_category_returns_all(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        cat = _make_category(db, tenant_a, popup, key=f"c-{uuid.uuid4().hex[:6]}")
        _make_attendee(db, tenant_a, popup, name="A", category_id=cat.id)
        _make_attendee(db, tenant_a, popup, name="B")

        _results, total = attendees_crud.find_by_popup(db, popup_id=popup.id)
        assert total == 2
