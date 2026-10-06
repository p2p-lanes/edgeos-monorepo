import uuid
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import HumanRating
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import ADMIN_API_KEY_SCOPES, create_access_token
from tests._flow_helpers import application_flow_id


def _headers(user: Users, tenant: Tenants) -> dict[str, str]:
    token = create_access_token(subject=user.id, token_type="user")
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-Id": str(tenant.id),
    }


def test_preview_and_download_cross_resource_xlsx(
    db: Session,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
    client: TestClient,
) -> None:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        name="Custom Export Test",
        slug=f"custom-export-{uuid.uuid4().hex[:8]}",
    )
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"export-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Export",
        last_name="Person",
    )
    db.add_all([popup, human])
    db.flush()
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=application_flow_id(db, popup.id),
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Export Attendee",
    )
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        application_id=application.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("125.50"),
        currency="EUR",
    )
    db.add_all([application, attendee, payment])
    db.commit()

    spec = {
        "dataset": "applications",
        "popup_id": str(popup.id),
        "columns": [
            {"field": "application.status"},
            {"field": "human.email", "label": "Applicant email"},
            {"field": "attendees.count"},
            {"field": "payments.approved_total"},
        ],
        "filters": [
            {
                "field": "application.status",
                "operator": "eq",
                "value": "accepted",
            }
        ],
        "format": "xlsx",
        "filename": "accepted-applications",
    }
    headers = _headers(admin_user_tenant_a, tenant_a)
    preview_response = client.post(
        "/api/v1/custom-exports/preview",
        json=spec,
        headers=headers,
    )
    assert preview_response.status_code == 200, preview_response.text
    preview = preview_response.json()
    assert preview["estimated_rows"] == 1
    assert preview["filename"] == "accepted-applications.xlsx"
    assert any("personally identifiable" in warning for warning in preview["warnings"])
    assert any("financial" in warning for warning in preview["warnings"])

    download_response = client.post(
        "/api/v1/custom-exports/download",
        json={"spec": preview["spec"], "fingerprint": preview["fingerprint"]},
        headers=headers,
    )
    assert download_response.status_code == 200, download_response.text
    assert download_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert (
        "accepted-applications.xlsx" in download_response.headers["content-disposition"]
    )

    workbook = load_workbook(BytesIO(download_response.content), read_only=True)
    rows = list(workbook["Export"].values)
    assert rows[0] == (
        "Application status",
        "Applicant email",
        "Attendee count",
        "Approved payment total",
    )
    assert rows[1] == ("accepted", human.email, 1, 125.5)

    csv_spec = {**spec, "format": "csv", "filename": "accepted-applications-csv"}
    csv_preview_response = client.post(
        "/api/v1/custom-exports/preview",
        json=csv_spec,
        headers=headers,
    )
    assert csv_preview_response.status_code == 200, csv_preview_response.text
    csv_preview = csv_preview_response.json()
    csv_response = client.post(
        "/api/v1/custom-exports/download",
        json={
            "spec": csv_preview["spec"],
            "fingerprint": csv_preview["fingerprint"],
        },
        headers=headers,
    )
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.headers["content-type"].startswith("text/csv")
    csv_lines = csv_response.content.decode("utf-8-sig").splitlines()
    assert csv_lines[0] == (
        "Application status,Applicant email,Attendee count,Approved payment total"
    )
    assert csv_lines[1] == f"accepted,{human.email},1,125.50"


@pytest.fixture
def rating_export(db: Session, tenant_a: Tenants):
    human = Humans(
        tenant_id=tenant_a.id,
        email=f"rating-export-{uuid.uuid4().hex}@test.com",
        rating=HumanRating.RED_FLAG,
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    spec = {
        "dataset": "humans",
        "columns": [{"field": "human.email"}, {"field": "human.rating"}],
        "filters": [{"field": "human.id", "operator": "eq", "value": str(human.id)}],
        "format": "csv",
    }
    return human, spec


@pytest.mark.parametrize(
    "token_fixture",
    ["admin_token_tenant_a", "operator_token_tenant_a", "superadmin_token"],
)
def test_authorized_jwts_can_export_ratings(
    client: TestClient, tenant_a: Tenants, rating_export, request, token_fixture
) -> None:
    human, spec = rating_export
    headers = {
        "Authorization": f"Bearer {request.getfixturevalue(token_fixture)}",
        "X-Tenant-Id": str(tenant_a.id),
    }
    assert (
        client.get("/api/v1/custom-exports/catalog", headers=headers).status_code == 200
    )
    response = client.post("/api/v1/custom-exports/preview", headers=headers, json=spec)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["estimated_rows"] == 1
    response = client.post(
        "/api/v1/custom-exports/download",
        headers=headers,
        json={"spec": preview["spec"], "fingerprint": preview["fingerprint"]},
    )
    assert response.status_code == 200, response.text
    assert response.content.decode("utf-8-sig").splitlines() == [
        "Email,Rating",
        f"{human.email},red_flag",
    ]


@pytest.mark.parametrize(
    "scopes", [["events:read"], ["humans:read"], sorted(ADMIN_API_KEY_SCOPES)]
)
def test_api_keys_cannot_access_exports_even_with_valid_jwt_fingerprint(
    client: TestClient,
    tenant_a: Tenants,
    admin_user_tenant_a: Users,
    admin_api_key_factory,
    rating_export,
    scopes,
) -> None:
    _, spec = rating_export
    response = client.post(
        "/api/v1/custom-exports/preview",
        headers=_headers(admin_user_tenant_a, tenant_a),
        json=spec,
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    _, raw_key = admin_api_key_factory(scopes)
    headers = {"Authorization": f"Bearer {raw_key}"}
    responses = [
        client.get("/api/v1/custom-exports/catalog", headers=headers),
        client.post("/api/v1/custom-exports/preview", headers=headers, json=spec),
        client.post(
            "/api/v1/custom-exports/download",
            headers=headers,
            json={"spec": preview["spec"], "fingerprint": preview["fingerprint"]},
        ),
    ]
    for response in responses:
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == (
            "This endpoint requires a JWT session; API keys are not accepted."
        )


@pytest.mark.parametrize(
    "caller",
    ["viewer_token_tenant_a", "check_in_controller_token_tenant_a", "human"],
)
def test_non_administrative_jwts_cannot_access_exports(
    client: TestClient, tenant_a: Tenants, rating_export, request, caller
) -> None:
    human, spec = rating_export
    token = (
        create_access_token(subject=human.id, token_type="human")
        if caller == "human"
        else request.getfixturevalue(caller)
    )
    headers = {"Authorization": f"Bearer {token}", "X-Tenant-Id": str(tenant_a.id)}
    responses = [
        client.get("/api/v1/custom-exports/catalog", headers=headers),
        client.post("/api/v1/custom-exports/preview", headers=headers, json=spec),
        client.post(
            "/api/v1/custom-exports/download",
            headers=headers,
            json={"spec": spec, "fingerprint": "unauthorized-fingerprint"},
        ),
    ]
    for response in responses:
        assert response.status_code == 403, response.text
