"""Repro test: POST /applications/my with group_id must create a main attendee."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.attendee_category.crud import attendee_categories_crud
from app.api.group.models import Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def test_group_application_creates_main_attendee(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    """POST /applications/my with group_id must auto-accept and create a main attendee."""
    popup = Popups(
        name=f"Group Test {uuid.uuid4().hex[:8]}",
        slug=f"group-test-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant_a.id,
    )
    db.add(popup)
    db.flush()

    main_cat = attendee_categories_crud.seed_main_for_popup(db, popup.id, tenant_a.id)
    assert main_cat is not None

    group = Groups(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="Group T",
        slug=f"group-t-{uuid.uuid4().hex[:8]}",
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    email = f"group-{uuid.uuid4().hex[:8]}@test.com"
    human = Humans(
        tenant_id=tenant_a.id,
        email=email,
        first_name="Express",
        last_name="Checkout",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    token = create_access_token(subject=human.id, token_type="human")

    response = client.post(
        "/api/v1/applications/my",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "popup_id": str(popup.id),
            "group_id": str(group.id),
            "first_name": "Express",
            "last_name": "Checkout",
            "status": "in review",
        },
    )

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["status"] == ApplicationStatus.ACCEPTED.value

    app_id = uuid.UUID(data["id"])
    db_attendees = db.exec(
        select(Attendees).where(Attendees.application_id == app_id)
    ).all()
    assert len(db_attendees) == 1, (
        f"Expected exactly 1 main attendee, got {len(db_attendees)}"
    )
    attendee = db_attendees[0]
    assert attendee.human_id == human.id
    assert attendee.category_id == main_cat.id

    assert "attendees" in data
    assert len(data["attendees"]) == 1
    assert data["attendees"][0]["id"] == str(attendee.id)
