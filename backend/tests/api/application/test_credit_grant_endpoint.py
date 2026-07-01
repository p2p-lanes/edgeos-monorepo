"""Tests for POST /applications/{application_id}/credit — admin manual credit grant.

Covers T-08:
  - Happy path: balance increases by amount, one credit.granted audit_logs row written
  - amount <= 0 rejected with 4xx
  - VIEWER role rejected with 403
  - Unauthenticated rejected with 4xx
  - Nonexistent application returns 404
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.user.models import Users

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"CreditGrant Popup {uuid.uuid4().hex[:6]}",
        slug=f"cg-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    suffix = uuid.uuid4().hex[:8]
    human = Humans(
        tenant_id=tenant.id,
        email=f"cg-{suffix}@test.com",
        first_name="Grant",
        last_name="Test",
    )
    db.add(human)
    db.flush()
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    credit: Decimal = Decimal("0"),
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        credit=credit,
    )
    db.add(application)
    db.flush()
    db.commit()
    db.refresh(application)
    return application


def _credit_granted_audit_entries(db: Session, human_id: uuid.UUID) -> list[AuditLog]:
    db.expire_all()
    return list(
        db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human_id,
                AuditLog.action == AuditAction.CREDIT_GRANTED,
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCreditGrantEndpoint:
    """T-08: POST /applications/{id}/credit — happy path and error cases."""

    def test_happy_path_balance_increases_and_audit_written(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        admin_user_tenant_a: Users,
        tenant_a: Tenants,
    ) -> None:
        """T-08: Admin grants 200 credit — balance increases, audit log written."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        assert application.credit == Decimal("0")

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "200.00", "note": "Welcome grant"},
            headers=_auth(admin_token_tenant_a),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert Decimal(body["credit"]) == Decimal("200.00")

        db.expire_all()
        db.refresh(application)
        assert application.credit == Decimal("200.00")

        entries = _credit_granted_audit_entries(db, human.id)
        assert len(entries) == 1
        entry = entries[0]
        assert entry.details["source"] == "manual"
        assert Decimal(entry.details["amount"]) == Decimal("200.00")
        assert entry.details.get("note") == "Welcome grant"

    def test_amount_zero_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Amount of 0 must be rejected with 4xx."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "0"},
            headers=_auth(admin_token_tenant_a),
        )
        assert response.status_code in (400, 422), response.text

    def test_amount_negative_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """Negative amount must be rejected with 4xx."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "-50.00"},
            headers=_auth(admin_token_tenant_a),
        )
        assert response.status_code in (400, 422), response.text

    def test_viewer_rejected(
        self,
        client: TestClient,
        db: Session,
        viewer_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """VIEWER role must be rejected with 403."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "100.00"},
            headers=_auth(viewer_token_tenant_a),
        )
        assert response.status_code == 403, response.text

    def test_unauthenticated_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """No auth token must be rejected."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "100.00"},
        )
        assert response.status_code in (401, 403), response.text

    def test_nonexistent_application_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Nonexistent application_id must return 404."""
        fake_id = uuid.uuid4()
        response = client.post(
            f"/api/v1/applications/{fake_id}/credit",
            json={"amount": "100.00"},
            headers=_auth(admin_token_tenant_a),
        )
        assert response.status_code == 404, response.text

    def test_operator_rejected_with_403(
        self,
        client: TestClient,
        db: Session,
        operator_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """OPERATOR role must be rejected with 403 — credit grant is admin-only."""
        popup = _make_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/{application.id}/credit",
            json={"amount": "100.00"},
            headers=_auth(operator_token_tenant_a),
        )
        assert response.status_code == 403, response.text
