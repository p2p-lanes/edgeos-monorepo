"""Regression tests for popup [start_date, end_date] event-window validation.

The popup form is a date-picker that stores midnight UTC of the chosen day,
so `end_date` must behave as an inclusive calendar day — an event ending
anywhere on that day must be accepted. Without this, picking "June 27" as the
popup end_date rejected every June 27 event (see Kevin Fishner's New Cities
lineup for EE26).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.event_settings.models import EventSettings
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _human_auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    start_date: datetime | None,
    end_date: datetime | None,
) -> Popups:
    popup = Popups(
        name=f"Window Test {uuid.uuid4().hex[:6]}",
        slug=f"window-{uuid.uuid4().hex[:10]}",
        tenant_id=tenant.id,
        start_date=start_date,
        end_date=end_date,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    # Enable portal event creation for this popup.
    db.add(EventSettings(tenant_id=tenant.id, popup_id=popup.id))
    db.commit()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"window-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _event_payload(popup: Popups, *, start: str, end: str) -> dict:
    return {
        "popup_id": str(popup.id),
        "title": "Window Event",
        "start_time": start,
        "end_time": end,
        "timezone": "UTC",
    }


class TestPopupEndDateInclusive:
    """End_date is the last day of the popup, not the first excluded instant."""

    def test_event_on_end_date_day_is_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        # Mirrors how the backoffice serializes the date-picker value.
        popup = _make_popup(
            db,
            tenant_a,
            start_date=datetime(2026, 6, 22, tzinfo=UTC),
            end_date=datetime(2026, 6, 27, tzinfo=UTC),
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(
                popup,
                start="2026-06-27T15:00:00+00:00",
                end="2026-06-27T17:00:00+00:00",
            ),
        )

        assert resp.status_code == 201, resp.text

    def test_event_past_end_date_day_is_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(
            db,
            tenant_a,
            start_date=datetime(2026, 6, 22, tzinfo=UTC),
            end_date=datetime(2026, 6, 27, tzinfo=UTC),
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(
                popup,
                start="2026-06-28T15:00:00+00:00",
                end="2026-06-28T17:00:00+00:00",
            ),
        )

        assert resp.status_code == 400, resp.text
        assert "end" in resp.json()["detail"].lower()

    def test_event_before_start_date_is_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(
            db,
            tenant_a,
            start_date=datetime(2026, 6, 22, tzinfo=UTC),
            end_date=datetime(2026, 6, 27, tzinfo=UTC),
        )
        human = _make_human(db, tenant_a)

        resp = client.post(
            "/api/v1/events/portal/events",
            headers=_human_auth(human),
            json=_event_payload(
                popup,
                start="2026-06-21T15:00:00+00:00",
                end="2026-06-21T17:00:00+00:00",
            ),
        )

        assert resp.status_code == 400, resp.text
        assert "start" in resp.json()["detail"].lower()
