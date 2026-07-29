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
