"""Application entry links resolve independently of portal discovery."""

import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from tests.api.sales_flow.test_portal_flow_listing import _human_token


@pytest.fixture
def entry(db: Session, tenant_a: Tenants):
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Entry links",
        slug=f"entry-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    flow = SalesFlows(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        name="By personal invitation",
        slug="invited",
        type="application",
        visibility="direct_url_only",
        requires_application_fee=False,
        open_checkout_signing_secret="must-not-be-public",
    )
    db.add(popup)
    db.flush()
    db.add(flow)
    db.commit()
    return popup, flow, {"Authorization": f"Bearer {_human_token(db, tenant_a)}"}


def _resolve(client, popup, identifier, headers):
    return client.get(
        "/api/v1/sales-flows/portal/application",
        params={"popup_id": str(popup.id), "identifier": identifier},
        headers=headers,
    )


@pytest.mark.parametrize("identifier_kind", ["slug", "id"])
def test_unlisted_entry_resolves_but_stays_out_of_discovery(
    client: TestClient, entry, identifier_kind: str
):
    popup, flow, headers = entry
    response = _resolve(client, popup, str(getattr(flow, identifier_kind)), headers)

    assert response.status_code == 200, response.text
    assert response.json()["id"] == str(flow.id)
    assert set(response.json()) == {
        "id",
        "slug",
        "name",
        "order",
        "type",
        "price_summary",
        "theme_config",
        "requires_application_fee",
        "application_fee_amount",
        "application_layout",
    }
    assert response.json()["requires_application_fee"] is False
    assert response.json()["application_fee_amount"] is None
    listed = client.get(
        "/api/v1/sales-flows/portal",
        params={"popup_id": str(popup.id)},
        headers=headers,
    )
    assert listed.status_code == 200
    assert str(flow.id) not in {item["id"] for item in listed.json()["results"]}


@pytest.mark.parametrize("identifier_kind", ["slug", "id"])
def test_closed_entry_is_blocked(
    client: TestClient, db: Session, entry, identifier_kind
):
    popup, flow, headers = entry
    flow.status = "closed"
    db.add(flow)
    db.commit()

    response = _resolve(client, popup, str(getattr(flow, identifier_kind)), headers)

    assert response.status_code == 403
    assert response.json()["detail"] == "This way in is closed"


@pytest.mark.parametrize("flow_type", ["direct", "upsale"])
def test_non_application_entry_is_blocked(
    client: TestClient, db: Session, entry, flow_type
):
    popup, flow, headers = entry
    flow.type = flow_type
    db.add(flow)
    db.commit()

    assert _resolve(client, popup, flow.slug, headers).status_code == 403


def test_inactive_popup_is_blocked(client: TestClient, db: Session, entry):
    popup, flow, headers = entry
    popup.status = "ended"
    db.add(popup)
    db.commit()

    assert _resolve(client, popup, flow.slug, headers).status_code == 403


def test_entry_uses_its_own_fee_and_layout(client: TestClient, db: Session, entry):
    popup, flow, headers = entry
    popup.requires_application_fee = True
    popup.application_fee_amount = Decimal("999")
    popup.application_layout = "multi_step"
    db.add(popup)
    db.commit()

    free = _resolve(client, popup, flow.slug, headers)
    assert free.status_code == 200
    assert free.json()["requires_application_fee"] is False
    assert free.json()["application_fee_amount"] is None
    assert free.json()["application_layout"] == "single_page"

    flow.requires_application_fee = True
    flow.application_fee_amount = Decimal("999")
    flow.application_layout = "multi_step"
    db.add(flow)
    db.commit()

    paid = _resolve(client, popup, str(flow.id), headers)
    assert paid.status_code == 200
    assert paid.json()["requires_application_fee"] is True
    assert Decimal(paid.json()["application_fee_amount"]) == Decimal("999")
    assert paid.json()["application_layout"] == "multi_step"


def test_id_from_another_popup_does_not_resolve(client: TestClient, db: Session, entry):
    popup, flow, headers = entry
    other = Popups(
        tenant_id=popup.tenant_id,
        name="Other popup",
        slug=f"other-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db.add(other)
    db.commit()

    assert _resolve(client, other, str(flow.id), headers).status_code == 404


@pytest.mark.parametrize("identifier", ["unknown", str(uuid.uuid4())])
def test_unknown_entry_does_not_fall_back(client: TestClient, entry, identifier):
    popup, _, headers = entry
    assert _resolve(client, popup, identifier, headers).status_code == 404


def test_other_tenant_cannot_resolve_entry(
    client: TestClient, db: Session, tenant_b: Tenants, entry
):
    popup, flow, _ = entry
    headers = {"Authorization": f"Bearer {_human_token(db, tenant_b)}"}
    assert _resolve(client, popup, str(flow.id), headers).status_code == 404


def test_entry_requires_authentication(client: TestClient, entry):
    popup, flow, _ = entry
    assert _resolve(client, popup, flow.slug, {}).status_code == 401
