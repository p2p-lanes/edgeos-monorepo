"""Flow-scoped email template creation (sdd/sales-flows slice 10, task 10.2).

`POST /email-templates` accepts an optional `sales_flow_id`. Threat-matrix
coverage (standing rule: every client-suppliable `sales_flow_id` is
validated for popup ownership via `_get_flow_or_404`):

- A flow-scoped row for the caller's own popup's own flow succeeds.
- A flow belonging to a DIFFERENT popup (same tenant) is rejected — 404,
  never silently accepted.
- `sales_flow_id` on a tenant-scoped type (`login_code_human`) is rejected —
  a portal login-code email was never popup-scoped and is not flow-scopable
  either (mirrors `ck_email_templates_scope`).
- A flow-tier row and the popup-shared row of the SAME type coexist (two
  disjoint tiers); two flow-tier rows for the SAME flow collide (duplicate).
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.schemas import SalesFlowCreate
from app.api.tenant.models import Tenants


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Flow Template Popup {uuid.uuid4().hex[:6]}",
        slug=f"flow-template-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str):
    return sales_flows_crud.create(
        db,
        SalesFlowCreate(popup_id=popup.id, slug=slug, name=slug),
        tenant_id=tenant.id,
    )


def test_flow_scoped_template_created_for_own_popup(
    client, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-a")

    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(flow.id),
            "template_type": "application_received",
            "subject": "Flow subject",
            "html_content": "<p>Flow content</p>",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["sales_flow_id"] == str(flow.id)
    assert body["popup_id"] == str(popup.id)


def test_flow_from_another_popup_rejected(
    client, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    popup = _make_popup(db, tenant_a)
    other_popup = _make_popup(db, tenant_a)
    foreign_flow = _make_flow(db, tenant_a, other_popup, slug="flow-foreign")

    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(foreign_flow.id),
            "template_type": "application_received",
            "subject": "Should fail",
            "html_content": "<p>Should fail</p>",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Sales flow not found for this popup"


def test_flow_scope_rejected_for_tenant_scoped_template_type(
    client, admin_token_tenant_a: str
) -> None:
    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "sales_flow_id": str(uuid.uuid4()),
            "template_type": "login_code_human",
            "subject": "Should fail",
            "html_content": "<p>Should fail</p>",
        },
    )

    assert response.status_code == 400
    assert "cannot be scoped to a sales flow" in response.json()["detail"]


def test_a_flow_owned_type_refuses_a_popup_tier_row(
    client, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    """A sale mail belongs to the flow that made the sale
    (sdd/sales-flows-rediseno). Written without one it would sit in a tier
    the send path never reads, which is the failure this repair removes.
    """
    popup = _make_popup(db, tenant_a)

    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup.id),
            "template_type": "application_received",
            "subject": "No flow",
            "html_content": "<p>No flow</p>",
        },
    )

    assert response.status_code == 400
    assert "belongs to a sales flow" in response.json()["detail"]


def test_two_flows_each_hold_their_own_copy(
    client, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    popup = _make_popup(db, tenant_a)
    flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")
    flow_c = _make_flow(db, tenant_a, popup, slug="flow-c")

    for flow, wording in ((flow_b, "Warm"), (flow_c, "Brisk")):
        response = client.post(
            "/api/v1/email-templates",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup.id),
                "sales_flow_id": str(flow.id),
                "template_type": "application_received",
                "subject": wording,
                "html_content": f"<p>{wording}</p>",
            },
        )
        assert response.status_code == 201, response.text

    duplicate = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup.id),
            "sales_flow_id": str(flow_b.id),
            "template_type": "application_received",
            "subject": "Duplicate",
            "html_content": "<p>Duplicate</p>",
        },
    )
    assert duplicate.status_code == 400


def test_a_gathering_owned_type_lives_on_the_popup(
    client, db: Session, tenant_a: Tenants, admin_token_tenant_a: str
) -> None:
    """An event invitation reaches everyone who is going, whatever they
    bought, so its sender has no flow to pass."""
    popup = _make_popup(db, tenant_a)

    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "popup_id": str(popup.id),
            "template_type": "event_invitation",
            "subject": "Come along",
            "html_content": "<p>Come along</p>",
        },
    )

    assert response.status_code == 201, response.text
