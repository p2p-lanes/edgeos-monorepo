import asyncio
from datetime import UTC, datetime
from unittest.mock import patch

from sqlmodel import select

from app.api.check_in.models import CheckIn
from app.api.payment.crud import payments_crud
from app.core.security import create_access_token
from app.services.checkin_pass_dispatch import dispatch_checkin_passes
from app.services.payment_notifications import _build_payment_confirmed_context
from tests._flow_helpers import application_flow_id
from tests.api.payment.test_product_unit_materialization import (
    _attendee_count,
    _product,
    _purchase,
    _units,
)
from tests.test_checkin_pass_dispatch import (
    EMAIL_TARGET,
    QR_TARGET,
    _make_human,
    _make_popup,
    _mock_email_service,
)


def _ownerless_unit(db, popup, buyer=None):
    product = _product(
        db,
        popup,
        category="parking",
        requires_check_in=True,
    )
    payment, line = _purchase(db, popup, product, quantity=1)
    payment.buyer_human_id = buyer.id if buyer else None
    db.add(payment)
    db.commit()
    payments_crud.approve_payment(db, payment.id)
    return payment, line, _units(db, payment)[0]


def _headers(actor, token_type):
    token = create_access_token(subject=actor.id, token_type=token_type)
    return {"Authorization": f"Bearer {token}"}


def test_ownerless_buyer_notifications_and_order_projection(client, db, tenant_a):
    popup = _make_popup(db, tenant_a, start_in_hours=1)
    application_flow_id(db, popup.id)
    buyer = _make_human(db, tenant_a)
    attendee_count = _attendee_count(db, popup)
    payment, line, unit = _ownerless_unit(db, popup, buyer)

    context = _build_payment_confirmed_context(
        payment, popup.name, buyer.first_name or "", None
    )
    assert context.attendees is None
    assert [(item.name, item.quantity) for item in context.products or []] == [
        (line.product_name, 1)
    ]

    response = client.get(
        f"/api/v1/payments/my/popup/{popup.id}", headers=_headers(buyer, "human")
    )
    assert response.status_code == 200, response.text
    units = response.json()["results"][0]["products_snapshot"][0]["units"]
    assert units == [
        {
            "id": str(unit.id),
            "attendee_id": None,
            "check_in_code": unit.check_in_code,
            "active": True,
            "requires_check_in": True,
        }
    ]
    email_service = _mock_email_service()

    with (
        patch(QR_TARGET, return_value="https://cdn.test/parking-qr.png"),
        patch(EMAIL_TARGET, return_value=email_service),
    ):
        summary = asyncio.run(dispatch_checkin_passes(db))

    assert (summary["emails_sent"], summary["tickets_marked"]) == (1, 1)
    call = email_service.send_check_in_pass.await_args
    assert call.kwargs["to"] == buyer.email
    qr = call.kwargs["context"].checkin_qrs[0]
    assert qr.attendee_name == buyer.display_name
    assert (qr.product_name, qr.check_in_code) == (
        line.product_name,
        unit.check_in_code,
    )
    assert unit.checkin_pass_sent_at is not None
    assert _attendee_count(db, popup) == attendee_count


def test_staff_ownerless_scan_repeats_and_rejects_unsafe_units(
    client,
    db,
    popup_tenant_a,
    popup_tenant_a_summer_fest,
    popup_tenant_b,
    admin_user_tenant_a,
):
    attendee_count = _attendee_count(db, popup_tenant_a)
    _, _, active = _ownerless_unit(db, popup_tenant_a)
    _, _, revoked = _ownerless_unit(db, popup_tenant_a)
    revoked.revoked_at = datetime.now(UTC)
    _, _, not_scannable = _ownerless_unit(db, popup_tenant_a)
    not_scannable.requires_check_in_snapshot = False
    _, _, wrong_popup = _ownerless_unit(db, popup_tenant_a_summer_fest)
    _, _, wrong_tenant = _ownerless_unit(db, popup_tenant_b)
    db.add_all([revoked, not_scannable])
    db.commit()
    headers = _headers(admin_user_tenant_a, "user")

    url = f"/api/v1/attendees/check-in/{active.check_in_code}?popup_id={popup_tenant_a.id}"
    first = client.post(url, json={"source": "qr"}, headers=headers)
    second = client.post(url, json={"source": "manual"}, headers=headers)
    assert first.status_code == second.status_code == 200
    assert first.json()["attendee"] is None
    assert (first.json()["total_scans"], second.json()["total_scans"]) == (1, 2)

    rejected = [
        (revoked, popup_tenant_a.id, 404),
        (not_scannable, popup_tenant_a.id, 400),
        (wrong_popup, popup_tenant_a.id, 404),
        (wrong_tenant, popup_tenant_b.id, 404),
    ]
    for unit, popup_id, expected in rejected:
        response = client.post(
            f"/api/v1/attendees/check-in/{unit.check_in_code}?popup_id={popup_id}",
            json={"source": "qr"},
            headers=headers,
        )
        assert response.status_code == expected, response.text

    blocked_ids = [unit.id for unit, _, _ in rejected]
    blocked_events = db.exec(
        select(CheckIn).where(CheckIn.attendee_product_id.in_(blocked_ids))
    ).all()
    assert blocked_events == []
    assert _attendee_count(db, popup_tenant_a) == attendee_count
