"""Regression test: submit_review endpoint grants application-fee credit on acceptance.

Path 7 (previously missing): a popup that requires an application fee AND uses a
manual-review approval strategy (ANY_REVIEWER). The applicant paid the fee
(APPROVED fee payment), the application is IN_REVIEW, and a reviewer submits a
YES decision via POST /api/v1/applications/{id}/reviews.

Before the fix, submit_review called recalculate_status (which transitioned the
application to ACCEPTED) but never called _maybe_grant_fee_credit, so
fee_credit_granted stayed False and credit remained 0.

After the fix, _maybe_grant_fee_credit is called immediately after
recalculate_status inside submit_review, mirroring the review_scholarship path.

Why this test fails without the fix
------------------------------------
Without the fix, submit_review does NOT call _maybe_grant_fee_credit after
recalculate_status. The application transitions to ACCEPTED (the status assertion
would still pass), but:
  - application.credit stays at Decimal("0")
  - application.fee_credit_granted stays False
  - No AuditLog row with action=CREDIT_GRANTED is written

The assertions on credit amount, fee_credit_granted, and the audit log would each
fail independently, making the regression unambiguous.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.shared.enums import SaleType, UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FEE_AMOUNT = Decimal("90.00")


def _make_manual_review_fee_popup(db: Session, tenant: Tenants) -> Popups:
    """Popup that requires an application fee AND uses ANY_REVIEWER strategy."""
    popup = Popups(
        tenant_id=tenant.id,
        name=f"ReviewFeePopup {uuid.uuid4().hex[:6]}",
        slug=f"rfp-{uuid.uuid4().hex[:6]}",
        sale_type=SaleType.application.value,
        status="active",
        currency="USD",
        requires_application_fee=True,
        application_fee_amount=FEE_AMOUNT,
    )
    db.add(popup)
    db.flush()

    # ANY_REVIEWER: one YES vote is enough to accept the application
    strategy = ApprovalStrategies(
        tenant_id=tenant.id,
        popup_id=popup.id,
        strategy_type=ApprovalStrategyType.ANY_REVIEWER,
    )
    db.add(strategy)
    db.flush()

    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"rfp-applicant-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Review",
        last_name="Applicant",
    )
    db.add(human)
    db.flush()
    return human


def _make_reviewer_user(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"rfp-reviewer-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_in_review_application_with_approved_fee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Applications:
    """Application that has already paid its fee and is waiting for a review decision."""
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.IN_REVIEW.value,
        credit=Decimal("0"),
        fee_credit_granted=False,
    )
    db.add(application)
    db.flush()

    # Approved fee payment — prerequisite for credit grant
    payment = Payments(
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        payment_type=PaymentType.APPLICATION_FEE.value,
        status=PaymentStatus.APPROVED.value,
        amount=FEE_AMOUNT,
        currency="USD",
        external_id=f"sf-rfp-{uuid.uuid4().hex[:8]}",
    )
    db.add(payment)
    db.commit()
    db.refresh(application)
    return application


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
# Regression test
# ---------------------------------------------------------------------------


class TestReviewGrantsFeeCredit:
    """POST /applications/{id}/reviews (YES) on a fee popup must grant credit."""

    def test_yes_review_on_any_reviewer_popup_grants_fee_credit(
        self,
        db: Session,
        tenant_a: Tenants,
        client: TestClient,
    ) -> None:
        """Regression: submit_review must call _maybe_grant_fee_credit after accepting.

        Scenario:
        - Popup: requires_application_fee=True, strategy=ANY_REVIEWER (one YES = ACCEPTED)
        - Application: IN_REVIEW, fee_credit_granted=False, credit=0
        - Fee payment: status=APPROVED
        - Action: reviewer submits YES via the HTTP endpoint
        - Expected: status=ACCEPTED, credit==FEE_AMOUNT, fee_credit_granted=True,
                    exactly one credit.granted audit log with source=="application_fee"
        """
        popup = _make_manual_review_fee_popup(db, tenant_a)
        human = _make_human(db, tenant_a)
        application = _make_in_review_application_with_approved_fee(
            db, tenant_a, popup, human
        )
        app_id = application.id

        reviewer = _make_reviewer_user(db, tenant_a)
        reviewer_token = create_access_token(subject=reviewer.id, token_type="user")

        response = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {reviewer_token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )
        assert response.status_code == 201, response.text

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None

        # Status must have transitioned to ACCEPTED
        assert fresh_app.status == ApplicationStatus.ACCEPTED.value, (
            f"Application should be ACCEPTED after YES review, got {fresh_app.status!r}"
        )

        # Credit must equal the fee amount — FAILS without the fix (stays 0)
        assert fresh_app.credit == FEE_AMOUNT, (
            f"Expected credit={FEE_AMOUNT}, got {fresh_app.credit} — "
            "_maybe_grant_fee_credit was not called from submit_review"
        )

        # Guard flag must be set — FAILS without the fix (stays False)
        assert fresh_app.fee_credit_granted is True, (
            "fee_credit_granted should be True after credit grant, got False — "
            "_maybe_grant_fee_credit was not called from submit_review"
        )

        # Exactly one audit log entry with source == "application_fee" — FAILS without fix
        entries = _credit_granted_entries(db, human.id)
        assert len(entries) == 1, (
            f"Expected exactly 1 credit.granted audit entry, got {len(entries)}"
        )
        assert entries[0].details["source"] == "application_fee", (
            f"Expected audit source 'application_fee', got {entries[0].details.get('source')!r}"
        )
        assert Decimal(str(entries[0].details["amount"])) == FEE_AMOUNT, (
            f"Expected audit amount={FEE_AMOUNT}, got {entries[0].details.get('amount')!r}"
        )
