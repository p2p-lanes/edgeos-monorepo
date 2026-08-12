"""Both add-a-companion routes refuse someone who is already at the gathering.

One person at one event is one attendee row. Two rows means two QR codes, two
directory entries, and stock spendable twice. These are the two routes that
add a person by email:

- POST /attendees/my/popup/{popup_id}
- POST /applications/my/{popup_id}/attendees

An application brings its own attendee row with it, so POST /applications has
to ask the same question before it creates one.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id


def _auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(subject=human.id, token_type='human')}"
    }


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Duplicate Guard {suffix}",
        slug=f"dup-guard-{suffix}-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"dup-guard-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> Applications:
    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()
    return application


def _make_companion_category(
    db: Session, tenant: Tenants, popup: Popups
) -> AttendeeCategories:
    category = AttendeeCategories(
        tenant_id=tenant.id,
        popup_id=popup.id,
        key="companion",
        label="Companion",
        is_primary=False,
        enabled_in_passes_flow=True,
    )
    db.add(category)
    db.flush()
    return category


def _count_rows(db: Session, popup: Popups, human: Humans) -> int:
    return db.exec(
        select(func.count())
        .select_from(Attendees)
        .where(Attendees.popup_id == popup.id, Attendees.human_id == human.id)
    ).one()


class TestAttendeeRoute:
    """POST /attendees/my/popup/{popup_id}"""

    def test_refuses_someone_who_got_here_by_buying(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="att-direct")
        holder = _make_human(db, tenant_a)
        _make_application(db, tenant_a, popup, holder)
        category = _make_companion_category(db, tenant_a, popup)
        already = _make_human(db, tenant_a)
        db.add(
            Attendees(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                application_id=None,
                popup_id=popup.id,
                human_id=already.id,
                name="Already Here",
                email=already.email,
                category="main",
            )
        )
        db.commit()

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(holder),
            json={
                "name": "Already Here",
                "email": already.email,
                "category_id": str(category.id),
            },
        )

        assert response.status_code == 409, response.text
        assert _count_rows(db, popup, already) == 1

    def test_refuses_someone_who_is_another_applicant_companion(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The case the ownership predicate missed: a companion is nobody's
        own attendee, so the guard used to wave them through."""
        popup = _make_popup(db, tenant_a, suffix="att-companion")
        first_holder = _make_human(db, tenant_a)
        first_application = _make_application(db, tenant_a, popup, first_holder)
        second_holder = _make_human(db, tenant_a)
        _make_application(db, tenant_a, popup, second_holder)
        category = _make_companion_category(db, tenant_a, popup)
        already = _make_human(db, tenant_a)
        db.add(
            Attendees(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                application_id=first_application.id,
                popup_id=popup.id,
                human_id=already.id,
                name="Already Here",
                email=already.email,
                category="companion",
            )
        )
        db.commit()

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(second_holder),
            json={
                "name": "Already Here",
                "email": already.email,
                "category_id": str(category.id),
            },
        )

        assert response.status_code == 409, response.text
        assert _count_rows(db, popup, already) == 1

    def test_still_adds_somebody_new(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="att-new")
        holder = _make_human(db, tenant_a)
        _make_application(db, tenant_a, popup, holder)
        category = _make_companion_category(db, tenant_a, popup)
        db.commit()

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(holder),
            json={
                "name": "Brand New",
                "email": f"brand-new-{uuid.uuid4().hex[:8]}@test.com",
                "category_id": str(category.id),
            },
        )

        assert response.status_code == 200, response.text


class TestApplicationRoute:
    """POST /applications/my/{popup_id}/attendees"""

    def test_refuses_someone_who_is_already_here(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """This route only compared emails inside the application, so the same
        person could be added again through it."""
        popup = _make_popup(db, tenant_a, suffix="app-direct")
        holder = _make_human(db, tenant_a)
        _make_application(db, tenant_a, popup, holder)
        category = _make_companion_category(db, tenant_a, popup)
        already = _make_human(db, tenant_a)
        db.add(
            Attendees(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                application_id=None,
                popup_id=popup.id,
                human_id=already.id,
                name="Already Here",
                email=already.email,
                category="main",
            )
        )
        db.commit()

        response = client.post(
            f"/api/v1/applications/my/{popup.id}/attendees",
            headers=_auth(holder),
            json={
                "name": "Already Here",
                "email": already.email,
                "category_id": str(category.id),
            },
        )

        assert response.status_code == 409, response.text
        assert _count_rows(db, popup, already) == 1

    def test_still_adds_somebody_new(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-new")
        holder = _make_human(db, tenant_a)
        _make_application(db, tenant_a, popup, holder)
        category = _make_companion_category(db, tenant_a, popup)
        db.commit()

        response = client.post(
            f"/api/v1/applications/my/{popup.id}/attendees",
            headers=_auth(holder),
            json={
                "name": "Brand New",
                "email": f"brand-new-{uuid.uuid4().hex[:8]}@test.com",
                "category_id": str(category.id),
            },
        )

        assert response.status_code == 201, response.text


class TestAdminApplicationRoute:
    """POST /applications — the superadmin path, which creates a primary
    attendee along with the application."""

    def test_refuses_an_application_for_another_applicant_companion(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        superadmin_token: str,
        tenant_a: Tenants,
    ) -> None:
        create = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"name": f"Duplicate Guard Admin {uuid.uuid4().hex[:8]}"},
        )
        assert create.status_code == 201, create.text
        popup = db.get(Popups, uuid.UUID(create.json()["id"]))
        assert popup is not None

        holder = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, holder)
        already = _make_human(db, tenant_a)
        db.add(
            Attendees(
                id=uuid.uuid4(),
                tenant_id=tenant_a.id,
                application_id=application.id,
                popup_id=popup.id,
                human_id=already.id,
                name="Already Here",
                email=already.email,
                category="companion",
            )
        )
        db.commit()

        response = client.post(
            "/api/v1/applications",
            headers={
                "Authorization": f"Bearer {superadmin_token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={
                "popup_id": str(popup.id),
                "first_name": "Already",
                "last_name": "Here",
                "email": already.email,
            },
        )

        assert response.status_code == 409, response.text
        assert _count_rows(db, popup, already) == 1


class TestApplicationAdoptsAnExistingRow:
    """An application brings a primary attendee with it. If the applicant is
    already here without one, it takes over that row instead."""

    def test_buying_first_and_applying_later_stays_one_row(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="adopt-direct")
        application_flow_id(db, popup.id)  # the door they will apply through
        buyer = _make_human(db, tenant_a)
        buyer.first_name = "Pat"
        buyer.last_name = "Doe"
        db.add(buyer)
        bought_row = Attendees(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            application_id=None,
            popup_id=popup.id,
            human_id=buyer.id,
            name="Pat Doe",
            email=buyer.email,
            category="main",
        )
        db.add(bought_row)
        db.commit()

        response = client.post(
            "/api/v1/applications/my",
            headers=_auth(buyer),
            json={
                "popup_id": str(popup.id),
                "first_name": "Pat",
                "last_name": "Doe",
            },
        )

        assert response.status_code in (200, 201), response.text
        db.expire_all()
        assert _count_rows(db, popup, buyer) == 1
        adopted = db.get(Attendees, bought_row.id)
        assert adopted is not None
        assert adopted.application_id == uuid.UUID(response.json()["id"])
