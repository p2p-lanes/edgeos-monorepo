"""Ended popups are visible in the portal only to participants.

TDD phase: RED — asserts the access-ladder seam the portal listing relies on.
"""

import uuid

from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants


def _make_ended_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name="Ended Popup",
        slug=f"ended-{uuid.uuid4().hex[:6]}",
        sale_type="application",
        status="ended",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"h-{uuid.uuid4().hex[:6]}@example.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _accept_application(db: Session, human: Humans, popup: Popups) -> None:
    db.add(
        Applications(
            tenant_id=popup.tenant_id,
            human_id=human.id,
            popup_id=popup.id,
            status="accepted",
        )
    )
    db.commit()


def test_ended_popup_listed_by_find(db: Session, tenant_a: Tenants) -> None:
    popup = _make_ended_popup(db, tenant_a)
    ended, _total = popups_crud.find(db, status=PopupStatus.ended, limit=100)
    assert popup.id in {p.id for p in ended}


def test_participant_has_access_to_ended_popup(db: Session, tenant_a: Tenants) -> None:
    popup = _make_ended_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    _accept_application(db, human, popup)

    access = applications_crud.resolve_popup_access(db, human.id, popup.id)

    assert access.allowed is True


def test_non_participant_denied_ended_popup(db: Session, tenant_a: Tenants) -> None:
    popup = _make_ended_popup(db, tenant_a)
    human = _make_human(db, tenant_a)  # no application

    access = applications_crud.resolve_popup_access(db, human.id, popup.id)

    assert access.allowed is False
