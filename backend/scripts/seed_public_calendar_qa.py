"""Idempotent public-calendar fixtures for a LOCAL development database only.

Run from backend/: python scripts/seed_public_calendar_qa.py
Creates dedicated qa-public-calendar-* popups in the existing demo tenant.
Never deletes or modifies the normal demo data. No email/API side effects.
"""

import argparse
import json
import sys
import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlmodel import Session, select

import app.models  # noqa: F401 -- register all relationship models
from app.api.event.models import Events
from app.api.event.schemas import EventStatus, EventVisibility
from app.api.event_settings.models import EventSettings
from app.api.event_venue.models import EventVenues
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.tenant.models import Tenants
from app.api.track.models import Tracks
from app.core.config import settings
from app.core.db import engine

PREFIX = "qa-public-calendar-"
NAMESPACE = uuid.UUID("8de3ca19-bb1b-4a17-a54c-a24b7f2bb279")


def fixture_id(key: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, key)


def upsert(db: Session, model, key: str, **values):
    row_id = fixture_id(key)
    row = db.get(model, row_id)
    if row is None:
        row = model(id=row_id, **values)
    else:
        if row.tenant_id != values["tenant_id"]:
            raise RuntimeError("Fixture ID belongs to a different tenant")
        for field, value in values.items():
            setattr(row, field, value)
    db.add(row)
    db.flush()
    return row


def seed(tenant_slug: str, today: date) -> dict:
    if settings.ENVIRONMENT.value != "dev" or settings.POSTGRES_SERVER not in {
        "localhost",
        "127.0.0.1",
        "::1",
        "db",
    }:
        raise RuntimeError("Refusing to seed: only a local dev database is allowed")

    manifest = {
        "base_date": today.isoformat(),
        "tenant_slug": tenant_slug,
        "scenarios": [],
    }
    with Session(engine) as db:
        tenant = db.exec(select(Tenants).where(Tenants.slug == tenant_slug)).first()
        if tenant is None or tenant.deleted:
            raise RuntimeError("An existing, non-deleted demo tenant is required")
        manifest["tenant_id"] = str(tenant.id)
        scenarios = [
            (
                "future",
                today + timedelta(days=240),
                today + timedelta(days=255),
                "America/Argentina/Buenos_Aires",
                PopupStatus.active,
            ),
            (
                "ongoing",
                today - timedelta(days=3),
                today + timedelta(days=4),
                "America/Argentina/Buenos_Aires",
                PopupStatus.active,
            ),
            (
                "ended",
                today - timedelta(days=240),
                today - timedelta(days=10),
                "America/Argentina/Buenos_Aires",
                PopupStatus.ended,
            ),
            (
                "empty",
                today + timedelta(days=30),
                today + timedelta(days=35),
                "UTC",
                PopupStatus.active,
            ),
            (
                "new-year",
                date(today.year + 1, 1, 1),
                date(today.year + 1, 1, 5),
                "Pacific/Kiritimati",
                PopupStatus.active,
            ),
        ]
        for scenario, start, end, timezone, status in scenarios:
            key = f"{tenant_slug}:{PREFIX}{scenario}"
            slug = f"{PREFIX}{scenario}"
            existing = db.exec(select(Popups).where(Popups.slug == slug)).first()
            if existing is not None and existing.id != fixture_id(key):
                raise RuntimeError(f"Refusing to overwrite non-fixture popup: {slug}")
            popup = upsert(
                db,
                Popups,
                key,
                tenant_id=tenant.id,
                slug=slug,
                name=f"QA Calendar - {scenario}",
                status=status,
                start_date=datetime.combine(start, time()),
                end_date=datetime.combine(end, time()),
            )
            upsert(
                db,
                EventSettings,
                f"{key}:settings",
                tenant_id=tenant.id,
                popup_id=popup.id,
                timezone=timezone,
                event_enabled=True,
                allowed_tags=["qa", "workshop", "social"],
                events_require_approval=False,
            )
            venue = upsert(
                db,
                EventVenues,
                f"{key}:venue",
                tenant_id=tenant.id,
                popup_id=popup.id,
                owner_id=fixture_id("owner"),
                title="QA Main Hall",
                location="Mock venue - local only",
            )
            track = upsert(
                db,
                Tracks,
                f"{key}:track",
                tenant_id=tenant.id,
                popup_id=popup.id,
                name="QA Workshops",
            )

            def event(
                label,
                day,
                hour=12,
                minute=0,
                *,
                rrule=None,
                visibility=EventVisibility.PUBLIC,
                event_status=EventStatus.PUBLISHED,
                timezone=timezone,
                key=key,
                popup=popup,
                venue=venue,
                track=track,
            ):
                instant = datetime.combine(
                    day, time(hour, minute), ZoneInfo(timezone)
                ).astimezone(UTC)
                return upsert(
                    db,
                    Events,
                    f"{key}:event:{label}",
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    owner_id=fixture_id("owner"),
                    title=f"QA {label}",
                    start_time=instant,
                    end_time=instant + timedelta(minutes=45),
                    timezone=timezone,
                    visibility=visibility,
                    status=event_status,
                    venue_id=venue.id,
                    track_id=track.id,
                    tags=["qa", "workshop"],
                    rrule=rrule,
                )

            expected = today
            public_count = 0
            if scenario == "future":
                expected = start + timedelta(days=2)
                event("FIRST PUBLIC - late night", expected, 23, 30)
                event("Future workshop", start + timedelta(days=5))
                event("Future last social", end - timedelta(days=2), 18)
                public_count = 3
            elif scenario == "ongoing":
                event("Yesterday workshop", today - timedelta(days=1))
                event("TODAY PUBLIC workshop", today, 12)
                event("Tomorrow social", today + timedelta(days=1), 18)
                public_count = 3
            elif scenario == "ended":
                first = end - timedelta(days=116)
                for i in range(205):
                    event(f"Archive workshop {i + 1:03}", first, 9 + i // 60, i % 60)
                event(
                    "LAST PUBLIC - recurring late night",
                    first,
                    23,
                    30,
                    rrule="FREQ=DAILY;COUNT=115",
                )
                expected = end - timedelta(days=2)
                public_count = 320
            elif scenario == "new-year":
                expected = start
                event("FIRST PUBLIC - UTC previous year", start, 0, 30)
                event("New year workshop", start + timedelta(days=2))
                public_count = 2

            if scenario != "empty":
                # These must not influence the first/last public day or leak into the UI.
                event(
                    "PRIVATE MUST NOT LEAK", start, visibility=EventVisibility.PRIVATE
                )
                event(
                    "UNLISTED MUST NOT LEAK", end, visibility=EventVisibility.UNLISTED
                )
                event("DRAFT MUST NOT LEAK", end, event_status=EventStatus.DRAFT)
                event(
                    "CANCELLED MUST NOT LEAK", end, event_status=EventStatus.CANCELLED
                )
            manifest["scenarios"].append(
                {
                    "slug": slug,
                    "status": status.value,
                    "timezone": timezone,
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "expected_initial_day": expected.isoformat(),
                    "expected_public_count": public_count,
                    "url": f"http://{tenant_slug}.localhost:3000/{slug}/calendar?view=calendar",
                }
            )
        db.commit()
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-slug", default="demo")
    parser.add_argument(
        "--base-date",
        type=date.fromisoformat,
        default=datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date(),
    )
    args = parser.parse_args()
    sys.stdout.write(
        json.dumps(seed(args.tenant_slug, args.base_date), indent=2) + "\n"
    )
