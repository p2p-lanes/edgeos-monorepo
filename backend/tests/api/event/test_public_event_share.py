"""Tests for GET /events/public/events/{event_id}/share.

Unauthenticated OpenGraph share-preview endpoint. A social crawler sends no
JWT, so the route is public — but it must only ever expose published events
with PUBLIC or UNLISTED visibility that belong to the resolved tenant.

Scenarios:
  - PUBLIC + published        -> 200 with {title, description, image_url}
  - UNLISTED + published      -> 200
  - PRIVATE + published       -> 404 (opaque)
  - PUBLIC + draft            -> 404 (opaque)
  - sibling tenant's event id -> 404 (opaque, no cross-tenant probing)
  - image fallback chain      -> cover -> venue photo -> popup placeholder
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, placeholder_url: str | None = None
) -> Popups:
    popup = Popups(
        name=f"Share Test {uuid.uuid4().hex[:6]}",
        slug=f"share-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    if placeholder_url is not None:
        db.add(
            EventSettings(
                tenant_id=tenant.id,
                popup_id=popup.id,
                timezone="UTC",
                placeholder_url=placeholder_url,
            )
        )
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    title: str = "Lightning Talk: Edge OS",
    content: str | None = None,
    cover_url: str | None = None,
    venue_id: uuid.UUID | None = None,
    visibility: EventVisibility = EventVisibility.PUBLIC,
    status: EventStatus = EventStatus.PUBLISHED,
) -> Events:
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        content=content,
        cover_url=cover_url,
        venue_id=venue_id,
        start_time=datetime(2026, 6, 7, 13, 0, tzinfo=UTC),
        end_time=datetime(2026, 6, 7, 14, 0, tzinfo=UTC),
        timezone="UTC",
        visibility=visibility,
        status=status,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def _make_venue(
    db: Session, tenant: Tenants, popup: Popups, *, image_url: str
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Main Stage",
        setup_time_minutes=0,
        teardown_time_minutes=0,
        status=VenueStatus.ACTIVE,
        image_url=image_url,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


def _url(event_id: uuid.UUID) -> str:
    return f"/api/v1/events/public/events/{event_id}/share"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_public_published_event_returns_share_meta(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """A public, published event returns title, description and image."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(
        db,
        tenant_a,
        popup,
        title="Lightning Talk: Edge OS",
        content="# Heading\n\nJoin us for a **deep dive** into Edge OS.",
        cover_url="https://cdn.example.com/cover.png",
    )

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(event.id)
    assert body["title"] == "Lightning Talk: Edge OS"
    assert body["image_url"] == "https://cdn.example.com/cover.png"
    # Markdown markers stripped, whitespace collapsed.
    assert body["description"] == "Heading Join us for a deep dive into Edge OS."


def test_unlisted_published_event_returns_share_meta(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Unlisted events are shareable (link-only access is intentional)."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, visibility=EventVisibility.UNLISTED)

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == event.title


def test_private_event_returns_404(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Private events keep the generic portal preview (opaque 404)."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, visibility=EventVisibility.PRIVATE)

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 404, resp.text


def test_draft_event_returns_404(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Unpublished (draft) public events are not shareable."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, status=EventStatus.DRAFT)

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 404, resp.text


def test_sibling_tenant_event_returns_404(
    client: TestClient, db: Session, tenant_a: Tenants, tenant_b: Tenants
) -> None:
    """An event id from another tenant must not leak across the boundary."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup)

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_b.id)})

    assert resp.status_code == 404, resp.text


def test_unknown_event_returns_404(client: TestClient, tenant_a: Tenants) -> None:
    """A random id resolves to an opaque 404, not a 500."""
    resp = client.get(_url(uuid.uuid4()), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 404, resp.text


def test_image_falls_back_to_venue_then_placeholder(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """No cover -> venue photo; no venue -> popup placeholder."""
    popup = _make_popup(
        db, tenant_a, placeholder_url="https://cdn.example.com/placeholder.png"
    )
    venue = _make_venue(
        db, tenant_a, popup, image_url="https://cdn.example.com/venue.png"
    )

    # cover absent, venue present -> venue image wins.
    with_venue = _make_event(db, tenant_a, popup, cover_url=None, venue_id=venue.id)
    resp = client.get(_url(with_venue.id), headers={"X-Tenant-Id": str(tenant_a.id)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_url"] == "https://cdn.example.com/venue.png"

    # cover and venue both absent -> popup placeholder.
    bare = _make_event(db, tenant_a, popup, cover_url=None, venue_id=None)
    resp = client.get(_url(bare.id), headers={"X-Tenant-Id": str(tenant_a.id)})
    assert resp.status_code == 200, resp.text
    assert resp.json()["image_url"] == "https://cdn.example.com/placeholder.png"


def test_empty_content_yields_null_description(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """No content -> description is null (not an empty string)."""
    popup = _make_popup(db, tenant_a)
    event = _make_event(db, tenant_a, popup, content=None)

    resp = client.get(_url(event.id), headers={"X-Tenant-Id": str(tenant_a.id)})

    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] is None
