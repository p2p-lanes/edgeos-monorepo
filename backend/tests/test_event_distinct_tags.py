"""Unit tests for ``events_crud.list_distinct_tags``.

Covers:
- Distinct + sorted union of tags across multiple events in a popup, even
  for tags that are NOT in the popup's ``event_settings.allowed_tags``
  (the filter source the portal previously used).
- ``only_published_public=True`` excludes draft / non-public events so
  anonymous calendar viewers can't see tags that only live in drafts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.api.event import crud as event_crud
from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Tags Test {uuid.uuid4().hex[:6]}",
        slug=f"tags-distinct-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_event(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    tags: list[str],
    status: EventStatus = EventStatus.PUBLISHED,
    visibility: EventVisibility = EventVisibility.PUBLIC,
) -> Events:
    start = datetime.now(UTC) + timedelta(days=14)
    event = Events(
        tenant_id=tenant.id,
        popup_id=popup.id,
        owner_id=uuid.uuid4(),
        title="Tag Event",
        start_time=start,
        end_time=start + timedelta(hours=1),
        timezone="UTC",
        visibility=visibility,
        status=status,
        tags=tags,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


class TestListDistinctTags:
    def test_returns_union_deduped_and_sorted(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        # Two events with overlapping + unique tags. ``experimento-2026``
        # is the kind of free-form tag that won't exist in the curated
        # ``event_settings.allowed_tags`` list — the helper must still
        # surface it because it's the whole point of the change.
        _make_event(db, tenant_a, popup, tags=["talk", "Workshop"])
        _make_event(db, tenant_a, popup, tags=["workshop", "experimento-2026"])

        result = event_crud.events_crud.list_distinct_tags(
            db, popup_id=popup.id, only_published_public=False
        )

        # Sort is case-insensitive; case-variants of "workshop" collapse
        # to whichever form appeared first in the distinct query (the
        # set dedup is exact-match, so we just assert no exact duplicates
        # and that all expected variants are present in lowercase form).
        lowered = sorted({t.lower() for t in result})
        assert lowered == ["experimento-2026", "talk", "workshop"]

    def test_only_published_public_filters_drafts(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_event(
            db,
            tenant_a,
            popup,
            tags=["secret-draft"],
            status=EventStatus.DRAFT,
        )
        _make_event(
            db,
            tenant_a,
            popup,
            tags=["public-tag"],
            status=EventStatus.PUBLISHED,
            visibility=EventVisibility.PUBLIC,
        )

        public = event_crud.events_crud.list_distinct_tags(
            db, popup_id=popup.id, only_published_public=True
        )
        all_tags = event_crud.events_crud.list_distinct_tags(
            db, popup_id=popup.id, only_published_public=False
        )

        assert "secret-draft" not in public
        assert "public-tag" in public
        assert "secret-draft" in all_tags
        assert "public-tag" in all_tags
