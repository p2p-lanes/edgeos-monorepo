"""Integration tests for PATCH /event-venues/reorder.

Covers:
- Reordering venues persists ``display_order`` and changes the listing
  order returned by GET /event-venues.
- Payloads referencing venues that don't belong to the target popup get
  rejected with 400 without partial updates.
- Venues omitted from the payload are pushed to the tail, preserving
  their relative pre-existing ordering.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event_venue.models import EventVenues
from app.api.event_venue.schemas import VenueStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Reorder Test {uuid.uuid4().hex[:6]}",
        slug=f"reorder-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_venue(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    title: str,
    display_order: int = 0,
) -> EventVenues:
    venue = EventVenues(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title=title,
        status=VenueStatus.ACTIVE,
        display_order=display_order,
    )
    db.add(venue)
    db.commit()
    db.refresh(venue)
    return venue


class TestVenueReorder:
    def test_reorder_changes_listing_order(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        a = _make_venue(db, tenant_a, popup, title="Alpha", display_order=0)
        b = _make_venue(db, tenant_a, popup, title="Bravo", display_order=1)
        c = _make_venue(db, tenant_a, popup, title="Charlie", display_order=2)

        # New order: C, A, B.
        resp = client.patch(
            "/api/v1/event-venues/reorder",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "venue_ids": [str(c.id), str(a.id), str(b.id)],
            },
        )
        assert resp.status_code == 204, resp.text

        listing = client.get(
            "/api/v1/event-venues",
            headers=_auth(admin_token_tenant_a),
            params={"popup_id": str(popup.id)},
        )
        assert listing.status_code == 200, listing.text
        order = [v["id"] for v in listing.json()["results"]]
        assert order == [str(c.id), str(a.id), str(b.id)]

    def test_reorder_rejects_venue_from_other_popup(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_one = _make_popup(db, tenant_a)
        popup_two = _make_popup(db, tenant_a)
        a = _make_venue(db, tenant_a, popup_one, title="Alpha", display_order=0)
        other = _make_venue(db, tenant_a, popup_two, title="Other", display_order=0)

        resp = client.patch(
            "/api/v1/event-venues/reorder",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup_one.id),
                "venue_ids": [str(a.id), str(other.id)],
            },
        )
        assert resp.status_code == 400, resp.text

        # The valid venue's display_order must not have changed.
        db.refresh(a)
        assert a.display_order == 0

    def test_reorder_pushes_omitted_venues_to_tail(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        a = _make_venue(db, tenant_a, popup, title="Alpha", display_order=0)
        b = _make_venue(db, tenant_a, popup, title="Bravo", display_order=1)
        c = _make_venue(db, tenant_a, popup, title="Charlie", display_order=2)

        # Only specify B at position 0; A and C should follow in their
        # original ``(display_order, title)`` order — so A then C.
        resp = client.patch(
            "/api/v1/event-venues/reorder",
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "venue_ids": [str(b.id)],
            },
        )
        assert resp.status_code == 204, resp.text

        listing = client.get(
            "/api/v1/event-venues",
            headers=_auth(admin_token_tenant_a),
            params={"popup_id": str(popup.id)},
        )
        assert listing.status_code == 200, listing.text
        order = [v["id"] for v in listing.json()["results"]]
        assert order == [str(b.id), str(a.id), str(c.id)]
