"""Tests for red-flagged human automatic rejection.

Red-flagged humans should have their applications automatically rejected,
regardless of the approval method (manual, auto-accept, review-based, group).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.crud import RedFlaggedHumanError, applications_crud
from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from app.services.approval.calculator import ApprovalCalculator


class TestRedFlagAutoReject:
    """Test that red-flagged humans have their applications automatically rejected."""

    def test_calculator_rejects_red_flagged_human(self) -> None:
        """ApprovalCalculator should return REJECTED when human is red-flagged."""
        calculator = ApprovalCalculator()

        # Even with auto-accept strategy, red-flagged should be rejected
        strategy = ApprovalStrategies(
            id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
        )

        result = calculator.calculate_status(
            strategy=strategy,
            reviews=[],
            designated_reviewers=[],
            human_red_flag=True,
        )

        assert result == ApplicationStatus.REJECTED

    def test_calculator_allows_acceptance_for_non_flagged_human(self) -> None:
        """ApprovalCalculator should allow acceptance when human is not red-flagged."""
        calculator = ApprovalCalculator()

        strategy = ApprovalStrategies(
            id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
        )

        result = calculator.calculate_status(
            strategy=strategy,
            reviews=[],
            designated_reviewers=[],
            human_red_flag=False,
        )

        assert result == ApplicationStatus.ACCEPTED

    def test_crud_accept_raises_for_red_flagged_human(
        self,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """CRUD accept() should raise RedFlaggedHumanError for red-flagged humans."""
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"red-flag-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Red",
            last_name="Flagged",
            red_flag=True,
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.flush()

        try:
            applications_crud.accept(db, application)
            raise AssertionError("Should have raised RedFlaggedHumanError")
        except RedFlaggedHumanError as e:
            assert "red-flagged" in str(e).lower()
        finally:
            db.rollback()

    def test_crud_submit_auto_rejects_red_flagged_human(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Submitting via portal endpoint should auto-reject red-flagged humans."""
        email = f"red-flag-submit-{uuid.uuid4().hex[:8]}@test.com"
        human = Humans(
            tenant_id=tenant_a.id,
            email=email,
            first_name="Red",
            last_name="Flagged",
            red_flag=True,
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup_tenant_a.id),
                "first_name": "Red",
                "last_name": "Flagged",
                "status": "in review",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] == ApplicationStatus.REJECTED.value
        assert data["accepted_at"] is None


class TestRedFlagAPIEndpoints:
    """Test red-flag blocking through API endpoints."""

    def test_admin_cannot_accept_red_flagged_application(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Submitting a YES review for a red-flagged human should not result in ACCEPTED.

        The recalculate_status catches red_flag and forces REJECTED instead.
        """
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"red-flag-api-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Red",
            last_name="Flagged",
            red_flag=True,
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)
        app_id = application.id

        response = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {admin_token_tenant_a}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )

        assert response.status_code == 201

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.REJECTED.value

    def test_admin_can_reject_red_flagged_application(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Red-flagged human's application is auto-rejected on portal submission."""
        email = f"red-flag-reject-{uuid.uuid4().hex[:8]}@test.com"
        human = Humans(
            tenant_id=tenant_a.id,
            email=email,
            first_name="Red",
            last_name="Flagged",
            red_flag=True,
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup_tenant_a.id),
                "first_name": "Red",
                "last_name": "Flagged",
                "status": "in review",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["status"] == ApplicationStatus.REJECTED.value

    def test_admin_can_accept_non_red_flagged_application(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        admin_user_tenant_a,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Submitting YES review for clean human with ANY_REVIEWER strategy → ACCEPTED."""
        existing_strategy = db.exec(
            select(ApprovalStrategies).where(
                ApprovalStrategies.popup_id == popup_tenant_a.id
            )
        ).first()

        if not existing_strategy:
            strategy = ApprovalStrategies(
                popup_id=popup_tenant_a.id,
                tenant_id=tenant_a.id,
                strategy_type=ApprovalStrategyType.ANY_REVIEWER,
            )
            db.add(strategy)
            db.commit()

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"normal-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Normal",
            last_name="User",
            red_flag=False,
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)
        app_id = application.id

        response = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {admin_token_tenant_a}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )

        assert response.status_code == 201

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.ACCEPTED.value


class TestRedFlagOnHumanUpdate:
    """Test that flagging a human auto-rejects their IN_REVIEW applications."""

    def test_flagging_human_rejects_in_review_applications(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """When a human is flagged, all their IN_REVIEW applications should be rejected."""
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"to-be-flagged-{uuid.uuid4().hex[:8]}@test.com",
            first_name="To Be",
            last_name="Flagged",
            red_flag=False,
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)

        response = client.patch(
            f"/api/v1/humans/{human.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"red_flag": True},
        )

        assert response.status_code == 200
        assert response.json()["red_flag"] is True

        db.refresh(application)
        assert application.status == ApplicationStatus.REJECTED.value

    def test_flagging_human_does_not_affect_already_rejected_applications(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """Flagging should not affect applications already in final states."""
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"already-rejected-{uuid.uuid4().hex[:8]}@test.com",
            first_name="Already",
            last_name="Rejected",
            red_flag=False,
        )
        db.add(human)
        db.flush()

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            status=ApplicationStatus.REJECTED.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)

        response = client.patch(
            f"/api/v1/humans/{human.id}",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"red_flag": True},
        )

        assert response.status_code == 200

        db.refresh(application)
        assert application.status == ApplicationStatus.REJECTED.value
