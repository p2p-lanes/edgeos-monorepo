"""Tests for popup publishable keys."""

from sqlmodel import Session

from app.api.tenant.models import Tenants
from tests.api.checkout.test_purchase import _make_popup


def test_publishable_key_model_persists(db: Session, tenant_a: Tenants) -> None:
    from app.api.publishable_key.models import PopupPublishableKeys

    popup = _make_popup(db, tenant_a, slug_prefix="pk")
    db.commit()

    row = PopupPublishableKeys(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Test key",
        key_prefix="pk_live_abcd",
        key_hash="deadbeef",
        allowed_origins=["https://checkout.example.com"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    assert row.id is not None
    assert row.allowed_origins == ["https://checkout.example.com"]
    assert row.revoked_at is None


def test_create_and_lookup_publishable_key(db: Session, tenant_a: Tenants) -> None:
    from app.api.publishable_key import crud

    popup = _make_popup(db, tenant_a, slug_prefix="pkc")
    db.commit()

    row, raw = crud.create_publishable_key(
        db,
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="External checkout",
        allowed_origins=["https://checkout.example.com"],
    )
    assert raw.startswith("pk_live_")
    assert crud.looks_like_publishable_key(raw) is True

    found = crud.lookup_active_by_raw(db, raw)
    assert found is not None
    assert found.id == row.id


def test_revoked_publishable_key_not_found(db: Session, tenant_a: Tenants) -> None:
    from app.api.publishable_key import crud

    popup = _make_popup(db, tenant_a, slug_prefix="pkr")
    db.commit()
    row, raw = crud.create_publishable_key(
        db, tenant_id=tenant_a.id, popup_id=popup.id, name="k", allowed_origins=[]
    )
    crud.revoke(db, row)
    assert crud.lookup_active_by_raw(db, raw) is None
