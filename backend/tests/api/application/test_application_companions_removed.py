"""Tests verifying that application drafting does not materialize attendees.

PR 2 tasks T2.1a — these tests are written RED-first to drive the removal.
"""

import asyncio
import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.models import PaymentRecipients, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import application_flow_id, seed_default_steps


def _new_application_context(
    db: Session,
    tenant: Tenants,
    *,
    fee: bool = False,
    strategy: ApprovalStrategyType | None = None,
) -> tuple[Popups, Humans]:
    suffix = uuid.uuid4().hex[:8]
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Deferred attendees {suffix}",
        slug=f"deferred-attendees-{suffix}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        simplefi_api_key="test-key",
    )
    db.add(popup)
    db.flush()
    flow = seed_default_steps(db, popup, sale_type=SaleType.application.value)
    if fee:
        flow.requires_application_fee = True
        flow.application_fee_amount = Decimal("25")
        db.add(flow)
    if strategy is not None:
        db.add(
            ApprovalStrategies(
                tenant_id=tenant.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                strategy_type=strategy,
            )
        )
    human = Humans(
        tenant_id=tenant.id,
        email=f"deferred-{suffix}@test.com",
        first_name="Deferred",
        last_name="Applicant",
    )
    db.add(human)
    db.commit()
    return popup, human


def _materialization_counts(db: Session, application_id: uuid.UUID) -> tuple[int, int]:
    attendees = list(
        db.exec(select(Attendees).where(Attendees.application_id == application_id))
    )
    holdings = list(
        db.exec(
            select(AttendeeProducts)
            .join(Attendees, Attendees.id == AttendeeProducts.attendee_id)
            .where(Attendees.application_id == application_id)
        )
    )
    return len(attendees), len(holdings)


def _portal_headers(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(
    ("requested_status", "strategy", "expected_status"),
    [
        ("draft", None, ApplicationStatus.DRAFT.value),
        (
            "in review",
            ApprovalStrategyType.ANY_REVIEWER,
            ApplicationStatus.IN_REVIEW.value,
        ),
        ("in review", None, ApplicationStatus.ACCEPTED.value),
    ],
)
def test_portal_application_create_does_not_materialize_attendees(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    requested_status: str,
    strategy: ApprovalStrategyType | None,
    expected_status: str,
) -> None:
    popup, human = _new_application_context(db, tenant_a, strategy=strategy)

    response = client.post(
        "/api/v1/applications/my",
        headers=_portal_headers(human),
        json={
            "popup_id": str(popup.id),
            "first_name": human.first_name,
            "last_name": human.last_name,
            "status": requested_status,
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == expected_status
    assert response.json()["attendees"] == []
    assert _materialization_counts(db, uuid.UUID(response.json()["id"])) == (0, 0)


def test_portal_draft_submit_update_does_not_materialize_attendees(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, human = _new_application_context(db, tenant_a)
    created = client.post(
        "/api/v1/applications/my",
        headers=_portal_headers(human),
        json={
            "popup_id": str(popup.id),
            "first_name": human.first_name,
            "last_name": human.last_name,
            "status": "draft",
        },
    )
    application_id = uuid.UUID(created.json()["id"])

    submitted = client.patch(
        f"/api/v1/applications/my/{popup.id}",
        headers=_portal_headers(human),
        json={"status": "in review"},
    )

    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["status"] == ApplicationStatus.ACCEPTED.value
    assert submitted.json()["attendees"] == []
    assert _materialization_counts(db, application_id) == (0, 0)


def test_pending_fee_create_retry_and_approval_remain_unmaterialized(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, human = _new_application_context(db, tenant_a, fee=True)
    headers = _portal_headers(human)
    application_response = client.post(
        "/api/v1/applications/my",
        headers=headers,
        json={
            "popup_id": str(popup.id),
            "first_name": human.first_name,
            "last_name": human.last_name,
            "status": "in review",
        },
    )
    application_id = uuid.UUID(application_response.json()["id"])
    provider_responses = [
        SimpleNamespace(
            id=f"fee-attempt-{index}",
            status="pending",
            checkout_url=f"https://pay.test/fee/{index}",
        )
        for index in range(2)
    ]

    with patch("app.services.simplefi.get_simplefi_client") as get_client:
        get_client.return_value.create_payment.side_effect = provider_responses
        first = client.post(
            "/api/v1/payments/my/application-fee",
            headers=headers,
            json={"application_id": str(application_id)},
        )
        first_payment = db.get(Payments, uuid.UUID(first.json()["id"]))
        assert first_payment is not None
        first_payment.status = PaymentStatus.REJECTED.value
        db.add(first_payment)
        db.commit()
        second = client.post(
            "/api/v1/payments/my/application-fee",
            headers=headers,
            json={"application_id": str(application_id)},
        )

    assert application_response.status_code == 201, application_response.text
    assert application_response.json()["status"] == ApplicationStatus.PENDING_FEE.value
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    from app.api.payment.router import _handle_fee_payment_approved

    second_payment = db.get(Payments, uuid.UUID(second.json()["id"]))
    assert second_payment is not None
    asyncio.run(_handle_fee_payment_approved(db, second_payment, source="test"))
    application = db.get(Applications, application_id)
    assert application is not None
    db.refresh(application)
    assert application.status == ApplicationStatus.ACCEPTED.value
    assert _materialization_counts(db, application_id) == (0, 0)
    assert (
        db.exec(
            select(PaymentRecipients).where(
                PaymentRecipients.payment_id.in_([first_payment.id, second_payment.id])
            )
        ).all()
        == []
    )


def test_admin_application_create_does_not_materialize_attendees(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    superadmin_token: str,
) -> None:
    popup, _ = _new_application_context(db, tenant_a)
    response = client.post(
        "/api/v1/applications",
        headers={
            "Authorization": f"Bearer {superadmin_token}",
            "X-Tenant-Id": str(tenant_a.id),
        },
        json={
            "popup_id": str(popup.id),
            "first_name": "Admin",
            "last_name": "Draft",
            "email": f"admin-draft-{uuid.uuid4().hex[:8]}@test.com",
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["attendees"] == []
    assert _materialization_counts(db, uuid.UUID(response.json()["id"])) == (0, 0)


def test_portal_companion_create_endpoint_is_gone(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup, human = _new_application_context(db, tenant_a)
    application = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=human.id,
        sales_flow_id=application_flow_id(db, popup.id),
        status=ApplicationStatus.ACCEPTED.value,
    )
    category = AttendeeCategories(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        key=f"companion-{uuid.uuid4().hex[:6]}",
        label="Companion",
        enabled_in_passes_flow=True,
    )
    db.add_all([application, category])
    db.commit()

    response = client.post(
        f"/api/v1/attendees/my/popup/{popup.id}",
        headers=_portal_headers(human),
        json={"name": "Draft Companion", "category_id": str(category.id)},
    )

    assert response.status_code == 410
    assert response.json()["detail"] == "Companion attendees are created after approval"
    assert _materialization_counts(db, application.id) == (0, 0)


def test_application_create_has_no_companions_field():
    """ApplicationCreate schema must not have a companions field."""
    from app.api.application.schemas import ApplicationCreate

    schema_fields = set(ApplicationCreate.model_fields.keys())
    assert "companions" not in schema_fields, (
        "companions field must be removed from ApplicationCreate"
    )


def test_application_admin_create_has_no_companions_field():
    """ApplicationAdminCreate schema must not have a companions field."""
    from app.api.application.schemas import ApplicationAdminCreate

    schema_fields = set(ApplicationAdminCreate.model_fields.keys())
    assert "companions" not in schema_fields, (
        "companions field must be removed from ApplicationAdminCreate"
    )


def test_application_public_has_no_brings_spouse():
    """ApplicationPublic must not have brings_spouse field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "brings_spouse" not in schema_fields, (
        "brings_spouse must be removed from ApplicationPublic"
    )


def test_application_public_has_no_brings_kids():
    """ApplicationPublic must not have brings_kids field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "brings_kids" not in schema_fields, (
        "brings_kids must be removed from ApplicationPublic"
    )


def test_application_public_has_no_kid_count():
    """ApplicationPublic must not have kid_count field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "kid_count" not in schema_fields, (
        "kid_count must be removed from ApplicationPublic"
    )


def test_application_crud_has_no_create_companions_method():
    """ApplicationsCRUD must not have a _create_companions method."""
    from app.api.application.crud import ApplicationsCRUD

    assert not hasattr(ApplicationsCRUD, "_create_companions"), (
        "_create_companions method must be removed from ApplicationsCRUD"
    )


def test_application_model_has_no_brings_spouse_property():
    """Applications model must not have brings_spouse property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "brings_spouse"), (
        "brings_spouse property must be removed from Applications model"
    )


def test_application_model_has_no_brings_kids_property():
    """Applications model must not have brings_kids property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "brings_kids"), (
        "brings_kids property must be removed from Applications model"
    )


def test_application_model_has_no_kid_count_property():
    """Applications model must not have kid_count property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "kid_count"), (
        "kid_count property must be removed from Applications model"
    )


def test_application_model_has_no_get_main_attendee_method():
    """Applications model must not have get_main_attendee method."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "get_main_attendee"), (
        "get_main_attendee method must be removed from Applications model"
    )


def test_companion_create_schema_does_not_exist():
    """CompanionCreate schema must not exist in attendee schemas."""
    import app.api.attendee.schemas as attendee_schemas

    assert not hasattr(attendee_schemas, "CompanionCreate"), (
        "CompanionCreate must be removed from attendee schemas"
    )


def test_form_section_kind_has_no_companions():
    """FormSectionKind must not have COMPANIONS value."""
    from app.api.form_section.schemas import FormSectionKind

    values = [e.value for e in FormSectionKind]
    assert "companions" not in values, "COMPANIONS must be removed from FormSectionKind"


def test_form_section_create_rejects_companions_kind(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a
):
    """POST /form-sections with kind='companions' must fail (422 or 400)."""
    popup_id = str(popup_tenant_a.id)

    resp = client.post(
        "/api/v1/form-sections",
        json={
            "popup_id": popup_id,
            "label": "Companions",
            "kind": "companions",
        },
        headers={
            "Authorization": f"Bearer {admin_token_tenant_a}",
        },
    )
    # Must fail — companions kind no longer exists in the enum
    assert resp.status_code in (400, 422), (
        f"Expected 400 or 422 for companions kind, got {resp.status_code}"
    )


def test_popup_create_ignores_allows_spouse(
    client: TestClient, admin_token_tenant_a: str
):
    """Creating a popup with allows_spouse must be ignored or rejected."""
    resp = client.post(
        "/api/v1/popups",
        json={
            "name": "Test Allows Spouse PR2",
            "allows_spouse": True,
            "sale_type": "application",
        },
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )
    # Either 201 (field ignored) or 422 (field rejected) — must not persist
    if resp.status_code == 201:
        data = resp.json()
        assert "allows_spouse" not in data, (
            "allows_spouse must not appear in popup response"
        )
    else:
        assert resp.status_code == 422, (
            f"Expected 201 (ignored) or 422 (rejected), got {resp.status_code}"
        )


def test_attenees_directory_entry_has_no_brings_kids():
    """AttendeesDirectoryEntry must not have brings_kids field."""
    from app.api.application.schemas import AttendeesDirectoryEntry

    schema_fields = set(AttendeesDirectoryEntry.model_fields.keys())
    assert "brings_kids" not in schema_fields, (
        "brings_kids must be removed from AttendeesDirectoryEntry"
    )
