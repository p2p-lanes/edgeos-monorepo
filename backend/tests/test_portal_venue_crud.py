"""Tests for portal venue CRUD via API key (PAT) auth.

Covers the venues:write scope: POST/PATCH/DELETE through the PAT route
policy, ownership enforcement on edit and delete, and the active-event
guard on delete.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.api_key import crud as api_key_crud
from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_settings.schemas import PublishPermission
from app.api.event_venue.models import (
    EventVenues,
    VenueExceptions,
    VenuePhotos,
    VenueProperties,
    VenuePropertyTypes,
    VenueWeeklyHours,
)
from app.api.event_venue.schemas import VenueBookingMode, VenueStatus
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _pat_auth(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Venue PAT Test {uuid.uuid4().hex[:6]}",
        slug=f"venue-pat-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _set_event_settings(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    humans_can_create_venues: bool = True,
    venues_require_approval: bool = False,
) -> EventSettings:
    existing = db.exec(
        select(EventSettings).where(EventSettings.popup_id == popup.id)
    ).first()
    if existing:
        db.delete(existing)
        db.commit()

    row = EventSettings(
        tenant_id=tenant.id,
        popup_id=popup.id,
        event_enabled=True,
        can_publish_event=PublishPermission.EVERYONE,
        humans_can_create_venues=humans_can_create_venues,
        venues_require_approval=venues_require_approval,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"venue-pat-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Venue",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_pat(
    db: Session,
    tenant: Tenants,
    human: Humans,
    *,
    scopes: list[str] | None = None,
    expires_at: datetime | None = None,
) -> str:
    _row, raw = api_key_crud.create_for_human(
        db,
        tenant_id=tenant.id,
        human_id=human.id,
        name=f"venue test pat {uuid.uuid4().hex[:4]}",
        expires_at=expires_at,
        scopes=scopes or ["events:read"],
    )
    return raw


def _make_venue(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    owner: Humans,
    *,
    status: VenueStatus = VenueStatus.ACTIVE,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=owner.id,
        title=f"PAT Venue {uuid.uuid4().hex[:4]}",
        status=status,
        booking_mode=VenueBookingMode.FREE,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _add_venue_dependents(
    db: Session,
    venue: EventVenues,
    tenant: Tenants,
) -> dict[str, object]:
    """Attach a photo, weekly-hour row, exception, and property link so we
    can assert they cascade-delete with the venue.

    Returns the ORM instances so callers can ``db.expunge`` them before
    re-querying — sqlalchemy will otherwise try to refresh stale state on
    the deleted rows and raise ``ObjectDeletedError``.
    """
    photo = VenuePhotos(
        tenant_id=tenant.id,
        venue_id=venue.id,
        image_url="https://example.com/photo.jpg",
        position=0,
    )
    weekly = VenueWeeklyHours(
        tenant_id=tenant.id,
        venue_id=venue.id,
        day_of_week=0,
        is_closed=True,
    )
    exception = VenueExceptions(
        tenant_id=tenant.id,
        venue_id=venue.id,
        start_datetime=datetime.now(UTC) + timedelta(days=1),
        end_datetime=datetime.now(UTC) + timedelta(days=1, hours=2),
        is_closed=True,
    )
    property_type = VenuePropertyTypes(
        tenant_id=tenant.id,
        name=f"PT-{uuid.uuid4().hex[:6]}",
    )
    db.add_all([photo, weekly, exception, property_type])
    db.commit()
    db.refresh(photo)
    db.refresh(weekly)
    db.refresh(exception)
    db.refresh(property_type)

    link = VenueProperties(
        tenant_id=tenant.id,
        venue_id=venue.id,
        property_type_id=property_type.id,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return {
        "photo": photo,
        "weekly": weekly,
        "exception": exception,
        "link": link,
        "property_type_id": property_type.id,
    }


def _venue_payload(popup: Popups, *, title: str | None = None) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": title or f"PAT Created {uuid.uuid4().hex[:4]}",
        "booking_mode": VenueBookingMode.FREE.value,
    }


def _future_expiry() -> str:
    return (datetime.now(UTC) + timedelta(days=7)).isoformat()


class TestPortalVenueCrudPat:
    def test_delete_venue_pat_without_scope_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)
        raw_key = _make_pat(db, tenant_a, owner, scopes=["events:read"])

        resp = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "API key lacks required scope: venues:write"

    def test_delete_venue_pat_wrong_owner_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)

        other = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            other,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        resp = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 403, resp.text
        assert "owner" in resp.json()["detail"].lower()

    def test_delete_venue_pat_success_204(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)
        ids = _add_venue_dependents(db, venue, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            owner,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        # Capture ids and detach the ORM instances BEFORE the DELETE call.
        # The API runs in its own session and cascade-deletes these rows;
        # if we hold attached, attribute-expired copies in our session,
        # any post-delete attribute access raises ObjectDeletedError.
        venue_id = venue.id
        photo_id = ids["photo"].id
        weekly_id = ids["weekly"].id
        exception_id = ids["exception"].id
        link_id = ids["link"].id
        property_type_id = ids["property_type_id"]
        for obj in (
            venue,
            ids["photo"],
            ids["weekly"],
            ids["exception"],
            ids["link"],
        ):
            db.expunge(obj)

        resp = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue_id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 204, resp.text

        assert (
            db.exec(select(EventVenues).where(EventVenues.id == venue_id)).first()
            is None
        )
        # Cascade-delete should sweep photos, weekly hours, exceptions, and
        # property links — but NOT the global property_type catalog entry.
        assert (
            db.exec(select(VenuePhotos).where(VenuePhotos.id == photo_id)).first()
            is None
        )
        assert (
            db.exec(
                select(VenueWeeklyHours).where(VenueWeeklyHours.id == weekly_id)
            ).first()
            is None
        )
        assert (
            db.exec(
                select(VenueExceptions).where(VenueExceptions.id == exception_id)
            ).first()
            is None
        )
        assert (
            db.exec(
                select(VenueProperties).where(VenueProperties.id == link_id)
            ).first()
            is None
        )
        assert (
            db.exec(
                select(VenuePropertyTypes).where(
                    VenuePropertyTypes.id == property_type_id
                )
            ).first()
            is not None
        )

    def test_delete_venue_pat_with_active_event_409(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)
        event = Events(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            owner_id=owner.id,
            title="Active Event",
            start_time=datetime.now(UTC) + timedelta(days=3),
            end_time=datetime.now(UTC) + timedelta(days=3, hours=1),
            timezone="UTC",
            visibility=EventVisibility.PUBLIC,
            status=EventStatus.PUBLISHED,
            venue_id=venue.id,
        )
        db.add(event)
        db.commit()
        db.refresh(event)

        raw_key = _make_pat(
            db,
            tenant_a,
            owner,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        resp = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_pat_auth(raw_key),
        )

        assert resp.status_code == 409, resp.text
        assert "linked events" in resp.json()["detail"].lower()

        # Venue must still exist.
        venue_id = venue.id
        assert (
            db.exec(select(EventVenues).where(EventVenues.id == venue_id)).first()
            is not None
        )

        # Cancel the event; delete should now succeed.
        event.status = EventStatus.CANCELLED
        db.add(event)
        db.commit()

        retry = client.delete(
            f"/api/v1/event-venues/portal/venues/{venue_id}",
            headers=_pat_auth(raw_key),
        )

        assert retry.status_code == 204, retry.text
        db.expunge(venue)
        assert (
            db.exec(select(EventVenues).where(EventVenues.id == venue_id)).first()
            is None
        )

    def test_create_venue_pat_with_scope_201(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(
            db,
            tenant_a,
            popup,
            humans_can_create_venues=True,
            venues_require_approval=False,
        )
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            human,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        resp = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_pat_auth(raw_key),
            json=_venue_payload(popup),
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == VenueStatus.ACTIVE.value
        assert body["owner_id"] == str(human.id)

    def test_create_venue_pat_without_scope_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _set_event_settings(db, tenant_a, popup)
        human = _make_human(db, tenant_a)
        raw_key = _make_pat(db, tenant_a, human, scopes=["events:read"])

        resp = client.post(
            "/api/v1/event-venues/portal/venues",
            headers=_pat_auth(raw_key),
            json=_venue_payload(popup),
        )

        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"] == "API key lacks required scope: venues:write"

    def test_patch_venue_pat_with_scope_200(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)
        raw_key = _make_pat(
            db,
            tenant_a,
            owner,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        resp = client.patch(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_pat_auth(raw_key),
            json={"title": "Updated via PAT"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Updated via PAT"

    def test_patch_venue_pat_wrong_owner_403(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        owner = _make_human(db, tenant_a)
        venue = _make_venue(db, tenant_a, popup, owner)

        other = _make_human(db, tenant_a)
        raw_key = _make_pat(
            db,
            tenant_a,
            other,
            scopes=["events:read", "venues:write"],
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )

        resp = client.patch(
            f"/api/v1/event-venues/portal/venues/{venue.id}",
            headers=_pat_auth(raw_key),
            json={"title": "Hijack attempt"},
        )

        assert resp.status_code == 403, resp.text
        assert "owner" in resp.json()["detail"].lower()

    def test_venues_write_api_key_defaults_expiry_when_omitted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.api.api_key.schemas import MAX_WRITE_SCOPE_LIFETIME_DAYS
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")

        resp = client.post(
            "/api/v1/api-keys",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "venue writer", "scopes": ["venues:write"]},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["expires_at"] is not None
        expires_at = datetime.fromisoformat(body["expires_at"])
        expected = datetime.now(UTC) + timedelta(days=MAX_WRITE_SCOPE_LIFETIME_DAYS)
        assert abs((expires_at - expected).total_seconds()) < 60

    def test_venues_write_api_key_with_expiry_ok(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        from app.core.security import create_access_token

        human = _make_human(db, tenant_a)
        token = create_access_token(subject=human.id, token_type="human")

        resp = client.post(
            "/api/v1/api-keys",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": "venue writer",
                "scopes": ["events:read", "venues:write"],
                "expires_at": _future_expiry(),
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "venues:write" in body["scopes"]
