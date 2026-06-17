"""HTTP tests for per-attendee additional_data + declarative required_fields.

Covers the kids-age restoration feature:
1. Creating a "kid" attendee with additional_data persists the blob and returns
   it on the AttendeePublic response.
2. A category whose required_fields marks a field required rejects creation with
   422 when that field is missing from additional_data.
3. Extra keys in additional_data are kept (permissive toward unknown fields).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"}


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"addl-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Addl Popup {suffix}",
        slug=f"addl-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_application(db: Session, tenant: Tenants, popup: Popups, human: Humans) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_kid_category(db: Session, tenant: Tenants, popup: Popups) -> AttendeeCategories:
    category = AttendeeCategories(
        tenant_id=tenant.id,
        popup_id=popup.id,
        key="kid",
        is_primary=False,
        enabled_in_passes_flow=True,
        required_fields=[
            {
                "name": "age_group",
                "type": "select",
                "required": True,
                "options": ["baby", "kid", "teen"],
                "label": "Age group",
                "display_as_subtitle": True,
            }
        ],
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


class TestAttendeeAdditionalData:
    def test_create_kid_persists_additional_data(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="kid-ok")
        human = _make_human(db, tenant_a, suffix="kid-ok")
        _make_application(db, tenant_a, popup, human)
        kid_cat = _make_kid_category(db, tenant_a, popup)

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={
                "name": "Little One",
                "category_id": str(kid_cat.id),
                "additional_data": {"age_group": "kid"},
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["additional_data"] == {"age_group": "kid"}
        assert body["category"] == "kid"

    def test_missing_required_field_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="kid-missing")
        human = _make_human(db, tenant_a, suffix="kid-missing")
        _make_application(db, tenant_a, popup, human)
        kid_cat = _make_kid_category(db, tenant_a, popup)

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={"name": "No Age", "category_id": str(kid_cat.id)},
        )

        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        codes = [d.get("code") for d in detail if isinstance(d, dict)]
        assert "required_field_missing" in codes

    def test_extra_keys_are_kept(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="kid-extra")
        human = _make_human(db, tenant_a, suffix="kid-extra")
        _make_application(db, tenant_a, popup, human)
        kid_cat = _make_kid_category(db, tenant_a, popup)

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={
                "name": "Extra Keys",
                "category_id": str(kid_cat.id),
                "additional_data": {
                    "age_group": "baby",
                    "nickname": "Junior",
                },
            },
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["additional_data"]["nickname"] == "Junior"
        assert body["additional_data"]["age_group"] == "baby"
