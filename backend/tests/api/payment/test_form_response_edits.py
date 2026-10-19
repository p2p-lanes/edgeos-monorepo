"""Only buyer answers may change, under the live deadline and editing policy."""

import uuid
from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.event_settings.models import EventSettings
from app.api.form_field.models import FormFields
from app.api.human.models import Humans
from app.api.payment.models import PaymentFormResponseChanges, Payments
from app.api.ticketing_step.models import TicketingSteps
from app.core.security import create_access_token
from tests.api.checkout.test_flow_scoped_runtime import _make_flow
from tests.api.checkout.test_purchase import _make_popup


@pytest.fixture
def purchase(db, tenant_a):
    popup = _make_popup(db, tenant_a, slug_prefix="response-edits")
    settings = db.exec(
        select(EventSettings).where(EventSettings.popup_id == popup.id)
    ).first()
    if settings is None:
        settings = EventSettings(tenant_id=tenant_a.id, popup_id=popup.id)
    settings.timezone = "Asia/Kolkata"
    db.add(settings)
    flow = _make_flow(db, popup, slug="answers")
    buyer = Humans(tenant_id=tenant_a.id, email=f"edits-{uuid.uuid4().hex}@test.com")
    db.add(buyer)
    db.flush()
    step = TicketingSteps(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        step_type="buyer",
        title="Delivery details",
        allow_response_editing=True,
        response_edit_deadline=datetime.now(UTC) + timedelta(days=1),
    )
    field = FormFields(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        name="location",
        label="Current label",
        field_type="select",
        required=True,
        options=["Riva Resort", "Circle Coworking"],
    )
    db.add(step)
    db.add(field)
    db.flush()
    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        buyer_human_id=buyer.id,
        status="approved",
        amount=30,
        buyer_snapshot={
            "buyer_email": buyer.email,
            "buyer_name": "Original buyer",
            "submitted_at": "2026-01-01T00:00:00Z",
            "attribution": {"utm_source": "test"},
            "sections": [
                {
                    "section_label": "Original section",
                    "fields": [
                        {
                            "field_id": str(field.id),
                            "field_name": field.name,
                            "field_label": "Original label",
                            "field_type": "select",
                            "value": "Riva Resort",
                        }
                    ],
                }
            ],
        },
    )
    db.add(payment)
    db.commit()
    return payment, buyer, step, field


def headers(buyer, *, scopes=None):
    return {
        "Authorization": "Bearer "
        + create_access_token(subject=buyer.id, token_type="human", scopes=scopes)
    }


def endpoint(payment):
    return f"/api/v1/payments/my/{payment.id}/form-responses"


def history(db, payment):
    return db.exec(
        select(PaymentFormResponseChanges).where(
            PaymentFormResponseChanges.payment_id == payment.id
        )
    ).all()


def test_edits_only_answer_values_with_atomic_history(
    client: TestClient, db: Session, purchase
):
    payment, buyer, step, field = purchase
    original = deepcopy(payment.buyer_snapshot)
    read = client.get(endpoint(payment), headers=headers(buyer))
    assert read.status_code == 200, read.text
    assert read.json()["can_edit"] is True
    assert read.json()["timezone"] == "Asia/Kolkata"
    response = client.patch(
        endpoint(payment),
        headers=headers(buyer),
        json={"version": 0, "answers": {str(field.id): "Circle Coworking"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["version"] == 1
    db.refresh(payment)
    expected = deepcopy(original)
    expected["sections"][0]["fields"][0]["value"] = "Circle Coworking"
    assert payment.buyer_snapshot == expected
    assert payment.amount == 30 and payment.status == "approved"
    rows = history(db, payment)
    assert len(rows) == 1
    assert (
        rows[0].old_value,
        rows[0].new_value,
        rows[0].changed_by_human_id,
        rows[0].version,
    ) == ("Riva Resort", "Circle Coworking", buyer.id, 1)
    assert rows[0].field_label == "Original label"
    # Optimistic locking: another tab cannot silently overwrite this change.
    response = client.patch(
        endpoint(payment),
        headers=headers(buyer),
        json={"version": 0, "answers": {str(field.id): "Riva Resort"}},
    )
    assert response.status_code == 409
    # An unchanged submission neither increments the version nor invents history.
    response = client.patch(
        endpoint(payment),
        headers=headers(buyer),
        json={"version": 1, "answers": {str(field.id): "Circle Coworking"}},
    )
    assert response.status_code == 200 and response.json()["version"] == 1
    assert len(history(db, payment)) == 1


@pytest.mark.parametrize(
    "scenario,expected",
    [
        ("disabled", 403),
        ("deadline", 403),
        ("pending", 403),
        ("cancelled", 403),
        ("wrong_buyer", 404),
        ("other_tenant", 404),
        ("unknown", 422),
        ("cross_flow", 422),
        ("empty", 422),
        ("invalid_option", 422),
        ("object", 422),
        ("extra_snapshot", 422),
        ("extra_status", 422),
        ("identity", 422),
        ("read_scope", 403),
        ("no_auth", 401),
        ("retyped", 422),
        ("deleted", 422),
    ],
)
def test_rejected_edits_change_nothing(
    client, db, tenant_b, purchase, scenario, expected
):
    payment, buyer, step, field = purchase
    original = deepcopy(payment.buyer_snapshot)
    auth = headers(buyer)
    value = "Circle Coworking"
    field_id = field.id
    body = {"version": 0, "answers": {str(field_id): value}}
    if scenario == "disabled":
        step.allow_response_editing = False
        db.add(step)
    if scenario == "deadline":
        step.response_edit_deadline = datetime.now(UTC) - timedelta(seconds=1)
        db.add(step)
    if scenario in ("pending", "cancelled"):
        payment.status = scenario
        db.add(payment)
    if scenario in ("wrong_buyer", "other_tenant"):
        other = Humans(
            tenant_id=tenant_b.id if scenario == "other_tenant" else buyer.tenant_id,
            email=f"other-{uuid.uuid4().hex}@test.com",
        )
        db.add(other)
        db.flush()
        auth = headers(other)
    if scenario == "unknown":
        body["answers"] = {str(uuid.uuid4()): value}
    if scenario == "cross_flow":
        other_flow = _make_flow(
            db, _make_popup(db, tenant_b, slug_prefix="other-flow"), slug="other"
        )
        other = FormFields(
            tenant_id=tenant_b.id,
            popup_id=other_flow.popup_id,
            sales_flow_id=other_flow.id,
            name="other",
            label="Other",
            field_type="text",
        )
        db.add(other)
        db.flush()
        body["answers"][str(other.id)] = "Other"
    if scenario == "empty":
        body["answers"][str(field.id)] = ""
    if scenario == "invalid_option":
        body["answers"][str(field.id)] = "Unconfigured option"
    if scenario == "object":
        body["answers"][str(field.id)] = {"value": value}
    if scenario == "extra_snapshot":
        body["buyer_snapshot"] = {"buyer_email": "attacker@test.com"}
    if scenario == "extra_status":
        body["status"] = "approved"
    if scenario == "identity":
        body["answers"] = {"buyer_email": "attacker@test.com"}
    if scenario == "read_scope":
        auth = headers(buyer, scopes=["portal:payments:read"])
    if scenario == "no_auth":
        auth = {}
    if scenario == "retyped":
        field.field_type = "text"
        db.add(field)
    if scenario == "deleted":
        db.delete(field)
    db.commit()
    response = client.patch(endpoint(payment), headers=auth, json=body)
    assert response.status_code == expected, response.text
    db.refresh(payment)
    assert payment.buyer_snapshot == original and payment.form_response_version == 0
    assert not history(db, payment)


def test_operator_can_read_history_but_not_bypass_portal_ownership(
    client, purchase, superadmin_token
):
    payment, buyer, step, field = purchase
    auth = {
        "Authorization": f"Bearer {superadmin_token}",
        "X-Tenant-Id": str(payment.tenant_id),
    }
    read = client.get(f"/api/v1/payments/{payment.id}/form-responses", headers=auth)
    assert read.status_code == 200, read.text
    assert (
        client.patch(
            endpoint(payment),
            headers=auth,
            json={"version": 0, "answers": {str(field.id): "Circle Coworking"}},
        ).status_code
        == 403
    )


def test_step_settings_require_deadline_and_validate_partial_updates(
    client, purchase, superadmin_token
):
    payment, buyer, step, field = purchase
    auth = {
        "Authorization": f"Bearer {superadmin_token}",
        "X-Tenant-Id": str(payment.tenant_id),
    }
    url = f"/api/v1/ticketing-steps/{step.id}"
    for body in [
        {"response_edit_deadline": None},
        {"allow_response_editing": None},
        {"response_edit_deadline": "2026-12-01T12:00:00"},
    ]:
        response = client.patch(url, headers=auth, json=body)
        assert response.status_code == 422, response.text
    response = client.patch(
        url,
        headers=auth,
        json={"allow_response_editing": False, "response_edit_deadline": None},
    )
    assert response.status_code == 200, response.text
    assert (
        client.get(endpoint(payment), headers=headers(buyer)).json()["can_edit"]
        is False
    )


@pytest.mark.parametrize(
    "kind,value,expected",
    [
        ("text", "New response", 200),
        ("text", {"nested": "value"}, 422),
        ("textarea", "Line 1\nLine 2", 200),
        ("number", "42.5", 200),
        ("number", "not a number", 422),
        ("boolean", False, 200),
        ("boolean", "true", 422),
        ("date", "2026-10-20", 200),
        ("date", "2026-02-30", 422),
        ("email", "answer@example.com", 200),
        ("email", "invalid@", 422),
        ("url", "https://example.com", 200),
        ("url", "javascript:alert(1)", 422),
        ("multiselect", ["Riva Resort", "Circle Coworking"], 200),
        ("multiselect", ["Riva Resort", "Riva Resort"], 422),
        ("multiselect_detailed", ["Riva Resort"], 200),
        ("select_cards", "Riva Resort", 200),
        ("radio", "Unconfigured", 422),
        ("rich_text", True, 200),
        ("rich_text", False, 422),
        ("phone", "+54 11 12345678", 200),
        ("country_select", "Argentina", 200),
        ("image_upload", "https://cdn.example.com/image.png", 200),
        ("signature", {"signature": "Jane Doe", "signed_at": "2026-10-16"}, 200),
        ("signature", {"signature": "Jane Doe"}, 422),
    ],
)
def test_form_field_types_are_validated_generically(
    client, db, purchase, kind, value, expected
):
    payment, buyer, step, field = purchase
    field.field_type = kind
    field.config = (
        {"is_checkbox": True}
        if kind == "rich_text"
        else {"require_date": True}
        if kind == "signature"
        else None
    )
    snapshot = deepcopy(payment.buyer_snapshot)
    snapshot["sections"][0]["fields"][0]["field_type"] = kind
    payment.buyer_snapshot = snapshot
    db.add(field)
    db.add(payment)
    db.commit()
    response = client.patch(
        endpoint(payment),
        headers=headers(buyer),
        json={"version": 0, "answers": {str(field.id): value}},
    )
    assert response.status_code == expected, response.text
    db.refresh(payment)
    if expected == 200:
        assert payment.buyer_snapshot["sections"][0]["fields"][0]["value"] == value
        assert len(history(db, payment)) == (0 if value == "Riva Resort" else 1)
    else:
        assert payment.buyer_snapshot == snapshot
        assert not history(db, payment)


def test_new_snapshots_include_unsectioned_fields_only_from_the_selected_flow(
    db, purchase, tenant_a
):
    from app.api.payment.crud import payments_crud
    from app.api.popup.models import Popups

    payment, buyer, step, field = purchase
    popup = db.get(Popups, payment.popup_id)
    other_flow = _make_flow(db, popup, slug="other-questions")
    other = FormFields(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=other_flow.id,
        name="other_question",
        label="Other flow question",
        field_type="text",
    )
    db.add(other)
    db.commit()
    snapshot = payments_crud._build_buyer_snapshot(
        [], [field], {field.name: "Riva Resort"}
    )
    fields = [f for s in snapshot["sections"] for f in s["fields"]]
    assert [f["field_id"] for f in fields] == [str(field.id)]
    assert fields[0]["value"] == "Riva Resort"


@pytest.mark.parametrize(
    "configured,expected",
    [
        ("America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires"),
        ("Mars/Unknown", "UTC"),
    ],
)
def test_response_timezone_follows_popup_settings(
    client, db, purchase, configured, expected
):
    payment, buyer, step, field = purchase
    settings = db.exec(
        select(EventSettings).where(EventSettings.popup_id == payment.popup_id)
    ).one()
    settings.timezone = configured
    db.add(settings)
    db.commit()
    response = client.get(endpoint(payment), headers=headers(buyer))
    assert response.status_code == 200, response.text
    assert response.json()["timezone"] == expected
    assert response.json()["deadline"] is not None
