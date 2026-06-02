"""Tests for staff-only event admin notes.

Covers the invariants that make the feature safe:
- Any backoffice user (here: a non-admin OPERATOR) can read and write notes.
- admin_notes NEVER appears in the event payload (no leak to portal/public).
- From the portal, a human whose email matches a backoffice User in the same
  tenant can read/write notes; a regular human is forbidden (403).
- The staff bridge is tenant-scoped: a matching email in another tenant does
  not grant access.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _human_auth(human: Humans) -> dict[str, str]:
    return {
        "Authorization": (
            f"Bearer {create_access_token(subject=human.id, token_type='human')}"
        )
    }


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Notes {uuid.uuid4().hex[:6]}",
        slug=f"notes-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(db: Session, tenant: Tenants, popup: Popups) -> Events:
    ev = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Notes Event",
        start_time=datetime(2026, 5, 5, 14, tzinfo=UTC),
        end_time=datetime(2026, 5, 5, 15, tzinfo=UTC),
        timezone="UTC",
        visibility=EventVisibility.PUBLIC,
        status=EventStatus.PUBLISHED,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def _make_human(db: Session, tenant: Tenants, *, email: str) -> Humans:
    # Reuse the (email, tenant) Human if it already exists. Backoffice event
    # creation now maps the owner to a Human sharing the admin's email, so a
    # prior test may have committed this exact Human; a raw insert would trip
    # the uq_human_email_tenant_id constraint.
    existing = db.exec(
        select(Humans).where(Humans.email == email, Humans.tenant_id == tenant.id)
    ).first()
    if existing:
        return existing
    h = Humans(tenant_id=tenant.id, email=email, first_name="N", last_name="H")
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def test_backoffice_operator_can_read_and_write_notes(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)

    read = client.get(
        f"/api/v1/events/{ev.id}/admin-notes",
        headers=_auth(operator_token_tenant_a),
    )
    assert read.status_code == 200, read.text
    assert read.json()["notes"] is None

    wrote = client.put(
        f"/api/v1/events/{ev.id}/admin-notes",
        headers=_auth(operator_token_tenant_a),
        json={"notes": "internal note"},
    )
    assert wrote.status_code == 200, wrote.text
    assert wrote.json()["notes"] == "internal note"

    again = client.get(
        f"/api/v1/events/{ev.id}/admin-notes",
        headers=_auth(operator_token_tenant_a),
    )
    assert again.json()["notes"] == "internal note"


def test_admin_notes_never_appear_in_event_payload(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_token_tenant_a: str,
) -> None:
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)
    client.put(
        f"/api/v1/events/{ev.id}/admin-notes",
        headers=_auth(admin_token_tenant_a),
        json={"notes": "TOP-SECRET-NOTE"},
    )

    detail = client.get(f"/api/v1/events/{ev.id}", headers=_auth(admin_token_tenant_a))
    assert detail.status_code == 200, detail.text
    assert "admin_notes" not in detail.json()
    assert "TOP-SECRET-NOTE" not in detail.text


def test_portal_staff_human_can_read_and_write_notes(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
) -> None:
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)
    # Human whose email matches a backoffice User in the same tenant → staff.
    staff = _make_human(db, tenant_a, email=admin_user_tenant_a.email)

    wrote = client.put(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(staff),
        json={"notes": "note from portal"},
    )
    assert wrote.status_code == 200, wrote.text
    assert wrote.json()["notes"] == "note from portal"

    read = client.get(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(staff),
    )
    assert read.status_code == 200
    assert read.json()["notes"] == "note from portal"


def test_portal_superadmin_human_can_edit_notes_cross_tenant(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    superadmin_user: Users,
) -> None:
    # A superadmin's User has no tenant_id, so the email match must grant staff
    # access in any tenant (the original same-tenant-only check 403'd them).
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)
    staff = _make_human(db, tenant_a, email=superadmin_user.email)

    wrote = client.put(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(staff),
        json={"notes": "superadmin via portal"},
    )
    assert wrote.status_code == 200, wrote.text
    assert wrote.json()["notes"] == "superadmin via portal"


def test_portal_regular_human_is_forbidden(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
) -> None:
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)
    regular = _make_human(db, tenant_a, email="regular-nobody@test.com")

    read = client.get(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(regular),
    )
    assert read.status_code == 403

    wrote = client.put(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(regular),
        json={"notes": "x"},
    )
    assert wrote.status_code == 403

    # And the portal event detail must not leak the field either.
    detail = client.get(
        f"/api/v1/events/portal/events/{ev.id}",
        headers=_human_auth(regular),
    )
    assert detail.status_code == 200, detail.text
    assert "admin_notes" not in detail.json()


def test_staff_bridge_is_tenant_scoped(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_user_tenant_b: Users,
) -> None:
    # A human in tenant_a whose email matches a User in tenant_b must NOT be
    # treated as staff in tenant_a.
    popup = _make_popup(db, tenant_a)
    ev = _make_event(db, tenant_a, popup)
    impostor = _make_human(db, tenant_a, email=operator_user_tenant_b.email)

    resp = client.get(
        f"/api/v1/events/portal/events/{ev.id}/admin-notes",
        headers=_human_auth(impostor),
    )
    assert resp.status_code == 403
