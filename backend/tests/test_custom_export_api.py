import uuid
from decimal import Decimal
from io import BytesIO

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
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token


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
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=popup.id,
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
    db.add_all([popup, human, application, attendee, payment])
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
