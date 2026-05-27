"""Validation for the popup-level check-in pass lead time.

`checkin_pass_lead_days` lives on the popup: null disables the scheduled
check-in pass; a positive value enables it. A non-positive value is rejected.
"""

import uuid

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupUpdate
from app.api.tenant.models import Tenants


def test_lead_days_none_is_allowed() -> None:
    # Omitted / null = check-in pass disabled for the popup.
    assert PopupUpdate().checkin_pass_lead_days is None
    assert PopupUpdate(checkin_pass_lead_days=None).checkin_pass_lead_days is None


def test_positive_lead_days_is_allowed() -> None:
    assert PopupUpdate(checkin_pass_lead_days=3).checkin_pass_lead_days == 3


def test_non_positive_lead_days_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PopupUpdate(checkin_pass_lead_days=0)
    with pytest.raises(ValidationError):
        PopupUpdate(checkin_pass_lead_days=-5)


def test_update_can_disable_an_enabled_popup(
    db: Session, tenant_a: Tenants
) -> None:
    # Regression for "can the backoffice turn the feature off again?":
    # the form sends an explicit null when the user clears the input, and
    # BaseCRUD.update must persist that null so the dispatcher stops picking
    # the popup up.
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        name="Disable Me",
        slug=f"disable-{uuid.uuid4().hex[:8]}",
        checkin_pass_lead_days=3,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    assert popup.checkin_pass_lead_days == 3

    popups_crud.update(db, popup, PopupUpdate(checkin_pass_lead_days=None))
    db.refresh(popup)
    assert popup.checkin_pass_lead_days is None

    enabled = popups_crud.list_with_checkin_pass_enabled(db)
    assert popup.id not in {p.id for p in enabled}
