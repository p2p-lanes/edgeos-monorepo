"""Validation for the popup-level check-in pass lead time.

`checkin_pass_lead_days` lives on the popup: null disables the scheduled
check-in pass; a positive value enables it. A non-positive value is rejected.
"""

import pytest
from pydantic import ValidationError

from app.api.popup.schemas import PopupUpdate


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
