"""A form the buyer cannot see must not block a quote or purchase."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.payment.models import Payments
from app.api.sales_flow.crud import sales_flows_crud
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps
from tests.api.checkout.test_flow_quote import _buyer, _offer
from tests.api.checkout.test_flow_scoped_runtime import _make_flow
from tests.api.checkout.test_purchase import _make_popup, _make_product, _recipient


@pytest.mark.parametrize(
    ("step_state", "answered", "expected_status"),
    [
        ("disabled", False, 200),
        ("absent", False, 200),
        ("enabled", False, 422),
        ("enabled", True, 200),
    ],
)
def test_required_answers_follow_the_named_flows_buyer_step(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    step_state: str,
    answered: bool,
    expected_status: int,
) -> None:
    popup = _make_popup(db, tenant_a, slug_prefix="buyer-step-gate")
    flow = _make_flow(db, popup, slug="form-gate")
    _offer(db, popup, flow)
    # The default flow's enabled buyer step must not govern this named flow.
    default = sales_flows_crud.get_default_flow(db, popup.id)
    assert default is not None
    assert (
        db.exec(
            select(TicketingSteps).where(
                TicketingSteps.sales_flow_id == default.id,
                TicketingSteps.step_type == "buyer",
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
        ).first()
        is not None
    )
    step = TicketingSteps(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        step_type="buyer",
        title="Details",
        is_enabled=step_state == "enabled",
    )
    if step_state != "absent":
        db.add(step)
    section = FormSections(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        label="Details",
        order=0,
    )
    db.add(section)
    db.flush()
    field = FormFields(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        section_id=section.id,
        name="preferred_location",
        label="Preferred location",
        field_type="text",
        required=True,
    )
    db.add(field)
    product = _make_product(db, popup, price="0.00")
    db.commit()
    data = {
        "products": [
            {"product_id": str(product.id), "quantity": 1, "recipient_key": "buyer"}
        ],
        "recipients": [_recipient(product)],
        "buyer": _buyer(
            email=f"buyer-{uuid.uuid4().hex}@test.com",
            form_data={field.name: "Test location"} if answered else {},
        ),
    }
    base = f"/api/v1/checkout/{popup.slug}/{flow.slug}"
    headers = {"X-Tenant-Id": str(tenant_a.id)}
    preview = client.post(base + "/preview", headers=headers, json=data)
    assert preview.status_code == 200, preview.text
    assert preview.json()["kind"] == (
        "estimate" if expected_status == 422 else "definitive"
    )
    purchase = client.post(base + "/purchase", headers=headers, json=data)
    assert purchase.status_code == expected_status, purchase.text
    if expected_status == 200:
        assert purchase.json()["status"] == "approved"
        payment = db.get(Payments, uuid.UUID(purchase.json()["payment_id"]))
        assert payment is not None and payment.sales_flow_id == flow.id
        assert payment.buyer_snapshot["sections"][0]["fields"][0]["value"] == (
            "Test location" if answered else None
        )
    # Enabling a configured step must immediately restore the required gate.
    if step_state == "disabled":
        step.is_enabled = True
        db.add(step)
        db.commit()
        blocked = client.post(base + "/purchase", headers=headers, json=data)
        assert blocked.status_code == 422, blocked.text
        # Disabling it never authorizes arbitrary field names or missing identity.
        step.is_enabled = False
        db.add(step)
        db.commit()
        data["buyer"]["form_data"] = {"unconfigured_question": "value"}
        assert (
            client.post(base + "/purchase", headers=headers, json=data).status_code
            == 422
        )
        data["buyer"]["form_data"] = {}
        email = data["buyer"].pop("email")
        assert (
            client.post(base + "/purchase", headers=headers, json=data).status_code
            == 422
        )
        data["buyer"]["email"] = email
        flow.restriction_rule = {
            "kind": "form_answer",
            "field_name": field.name,
            "op": "eq",
            "value": "Allowed",
        }
        db.add(flow)
        db.commit()
        assert (
            client.post(base + "/preview", headers=headers, json=data).status_code
            == 403
        )
        assert (
            client.post(base + "/purchase", headers=headers, json=data).status_code
            == 403
        )
