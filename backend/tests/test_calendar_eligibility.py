from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from app.api.application.models import Applications
from app.api.sales_flow.models import SalesFlows
from app.services.event_itip import gather_event_recipients
from tests._flow_helpers import application_flow_id
from tests.test_event_participants import (
    _give_ticket,
    _human_headers,
    _make_event,
    _make_human,
    _make_popup,
)


@pytest.mark.parametrize("main_rejected", [False, True])
def test_only_main_application_controls_rsvp(client, db, tenant_a, main_rejected):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    event = _make_event(db, tenant_a, popup)
    _give_ticket(db, tenant_a, popup, human)
    main_id = application_flow_id(db, popup.id)
    extra = SalesFlows(
        tenant_id=tenant_a.id, popup_id=popup.id, slug="volunteers", name="Volunteers"
    )
    db.add(extra)
    db.flush()
    db.add(
        Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            sales_flow_id=main_id,
            status="rejected" if main_rejected else "accepted",
        )
    )
    db.add(
        Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            sales_flow_id=extra.id,
            status="accepted" if main_rejected else "rejected",
        )
    )
    db.commit()
    eligibility = client.get(
        f"/api/v1/event-participants/portal/eligibility/{popup.id}",
        headers=_human_headers(human),
    )
    assert eligibility.status_code == 200
    assert eligibility.json() == {
        "allowed": not main_rejected,
        "reason": "rejected" if main_rejected else None,
    }
    with patch(
        "app.services.event_itip.send_itip_to_single_recipient", new=AsyncMock()
    ) as send:
        response = client.post(
            f"/api/v1/event-participants/portal/register/{event.id}",
            headers=_human_headers(human),
        )
    assert response.status_code == (403 if main_rejected else 200), response.text
    assert send.await_count == (0 if main_rejected else 1)


@pytest.mark.parametrize("loss", ["revoked_ticket", "rejected_application"])
@pytest.mark.parametrize("action", ["update", "cancel"])
def test_notifications_recheck_access_and_recovery(
    client, db, tenant_a, admin_token_tenant_a, loss, action
):
    popup = _make_popup(db, tenant_a)
    human = _make_human(db, tenant_a)
    event = _make_event(db, tenant_a, popup)
    attendee = _give_ticket(db, tenant_a, popup, human)
    with patch(
        "app.services.event_itip.send_itip_to_single_recipient", new=AsyncMock()
    ):
        response = client.post(
            f"/api/v1/event-participants/portal/register/{event.id}",
            headers=_human_headers(human),
        )
    assert response.status_code == 200, response.text
    assert {r["human_id"] for r in gather_event_recipients(db, event)} == {human.id}

    if loss == "revoked_ticket":
        db.refresh(attendee)
        subject = attendee.attendee_products[0]
        field, invalid, valid = "revoked_at", datetime.now(UTC), None
    else:
        subject = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            sales_flow_id=application_flow_id(db, popup.id),
        )
        field, invalid, valid = "status", "rejected", "accepted"
    for value, allowed in [(invalid, False), (valid, True), (invalid, False)]:
        setattr(subject, field, value)
        db.add(subject)
        db.commit()
        assert bool(gather_event_recipients(db, event)) == allowed

    with patch("app.services.event_itip.send_event_itip", new=AsyncMock()) as send:
        headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
        if action == "update":
            response = client.patch(
                f"/api/v1/events/{event.id}",
                headers=headers,
                json={"title": "New title"},
            )
        else:
            response = client.post(f"/api/v1/events/{event.id}/cancel", headers=headers)
    assert response.status_code == 200, response.text
    assert send.await_count == 1
    assert send.await_args.args[2] == []
