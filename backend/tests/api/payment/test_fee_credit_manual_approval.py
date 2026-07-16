"""Integration test: manual backoffice approval of APPLICATION_FEE payment.

RED-first (TDD): before the fix, PATCH /{payment_id} with status=approved on an
APPLICATION_FEE payment calls update_status which does NOT transition the application
out of PENDING_FEE and does NOT grant credit.  After the fix it must:

  1. Set payment.status = APPROVED.
  2. Transition application from PENDING_FEE → ACCEPTED (AUTO_ACCEPT popup, no strategy).
  3. Grant fee as credit: application.credit == fee_amount.
  4. Set fee_credit_granted = True.
  5. Write exactly one credit.granted audit log with source == "application_fee".
  6. NOT null existing settlement_currency on the payment (non-destructive overwrite).

The test is driven through the HTTP PATCH endpoint so the routing path in
update_payment() is covered, not just _handle_fee_payment_approved() directly.
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
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FEE_AMOUNT = Decimal("80.00")


def _make_fee_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"ManualFeePopup {uuid.uuid4().hex[:6]}",
        slug=f"mfp-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        requires_application_fee=True,
        application_fee_amount=FEE_AMOUNT,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"mfa-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Manual",
        last_name="Approval",
    )
    db.add(human)
    db.flush()
    return human


def _make_pending_fee_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.PENDING_FEE.value,
        credit=Decimal("0"),
        fee_credit_granted=False,
    )
    db.add(application)
    db.flush()
    return application


def _make_pending_fee_payment(
    db: Session, tenant: Tenants, popup: Popups, application: Applications
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        payment_type=PaymentType.APPLICATION_FEE.value,
        status=PaymentStatus.PENDING.value,
        amount=FEE_AMOUNT,
        currency="USD",
        external_id=f"sf-mfa-{uuid.uuid4().hex[:8]}",
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _credit_granted_entries(db: Session, human_id: uuid.UUID) -> list[AuditLog]:
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


class TestManualFeeApprovalViaEndpoint:
    """PATCH /{payment_id} with status=approved on APPLICATION_FEE must route through
    _handle_fee_payment_approved so application transitions and credit is granted."""

    def test_manual_approval_transitions_application_and_grants_credit(
        self,
        db: Session,
        tenant_a: Tenants,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """RED: before fix — application stays PENDING_FEE, no credit granted.
        GREEN: after fix — application transitions, credit == fee_amount, audit written."""
        popup = _make_fee_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_pending_fee_application(db, tenant_a, popup, human)
        payment = _make_pending_fee_payment(db, tenant_a, popup, application)

        # Approve via backoffice PATCH endpoint
        resp = client.patch(
            f"/api/v1/payments/{payment.id}",
            json={"status": "approved"},
            headers={
                "Authorization": f"Bearer {admin_token_tenant_a}",
                "X-Tenant-Id": str(tenant_a.id),
            },
        )
        assert resp.status_code == 200, resp.text

        # Payment must be APPROVED
        db.expire_all()
        db.refresh(payment)
        assert payment.status == PaymentStatus.APPROVED.value

        # Application must have transitioned out of PENDING_FEE
        db.refresh(application)
        assert application.status != ApplicationStatus.PENDING_FEE.value, (
            f"Application is still in PENDING_FEE after manual fee approval — "
            f"fix not applied: got {application.status!r}"
        )

        # Credit must be granted
        assert application.credit == FEE_AMOUNT, (
            f"Expected credit={FEE_AMOUNT}, got {application.credit} — "
            f"_handle_fee_payment_approved was not called from update_payment"
        )
        assert application.fee_credit_granted is True

        # Exactly one credit.granted audit log with source == "application_fee"
        entries = _credit_granted_entries(db, human.id)
        assert len(entries) == 1, (
            f"Expected 1 credit.granted audit entry, got {len(entries)}"
        )
        assert entries[0].details["source"] == "application_fee"
        assert Decimal(str(entries[0].details["amount"])) == FEE_AMOUNT

    def test_settlement_currency_not_nulled_on_existing_value(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Non-destructive overwrite: passing settlement_currency=None must not null
        an existing value on the payment (covers the _handle_fee_payment_approved fix)."""
        import asyncio

        from app.api.payment.router import _handle_fee_payment_approved

        popup = _make_fee_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_pending_fee_application(db, tenant_a, popup, human)
        payment = _make_pending_fee_payment(db, tenant_a, popup, application)

        # Pre-set settlement_currency (simulates a partial update already recorded)
        payment.settlement_currency = "BTC"
        db.add(payment)
        db.flush()

        # Call handler with settlement_currency=None (manual path)
        asyncio.run(
            _handle_fee_payment_approved(
                db, payment, settlement_currency=None, source="manual"
            )
        )

        db.expire_all()
        db.refresh(payment)
        assert payment.settlement_currency == "BTC", (
            "settlement_currency was nulled out — the non-destructive guard is missing"
        )
