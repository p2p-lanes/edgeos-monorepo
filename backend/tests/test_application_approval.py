"""Tests for application approval transitions.

Covers all 10 approval state-machine paths:
1.  Portal submit → AUTO_ACCEPT (no strategy) → ACCEPTED
2.  Portal submit → ANY_REVIEWER strategy → IN_REVIEW
3.  Portal submit → red-flagged human → REJECTED
4.  PATCH /my/{popup_id} draft→submit → AUTO_ACCEPT → ACCEPTED
5.  PATCH /my/{popup_id} draft→submit → ANY_REVIEWER → IN_REVIEW
6.  Review YES → ANY_REVIEWER → ACCEPTED
7.  Review NO (all required) → ANY_REVIEWER → REJECTED
8.  THRESHOLD(2): 2 YES votes → ACCEPTED
9.  THRESHOLD(2): 1 YES + 1 NO (all designated voted) → REJECTED
10. Group leader adds existing IN_REVIEW member → ACCEPTED (accepted_at set)
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.popup_reviewer.models import PopupReviewers
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants, *, slug_suffix: str) -> Popups:
    """Create a fresh popup for isolated test scenarios."""
    slug = f"approval-test-{slug_suffix}"
    popup = db.exec(select(Popups).where(Popups.slug == slug)).first()
    if not popup:
        popup = Popups(
            name=f"Approval Test {slug_suffix}",
            slug=slug,
            tenant_id=tenant.id,
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)
    return popup


def _make_human(
    db: Session, tenant: Tenants, *, email: str, red_flag: bool = False
) -> Humans:
    """Create a human for testing."""
    human = Humans(
        tenant_id=tenant.id,
        email=email,
        first_name="Test",
        last_name="Human",
        red_flag=red_flag,
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_reviewer_user(db: Session, tenant: Tenants, *, email: str) -> Users:
    """Create an admin user to act as reviewer."""
    user = Users(
        email=email,
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _set_strategy(
    db: Session,
    popup: Popups,
    tenant: Tenants,
    *,
    strategy_type: ApprovalStrategyType,
    required_approvals: int = 1,
) -> ApprovalStrategies:
    """Create or replace the approval strategy for a popup."""
    existing = db.exec(
        select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup.id)
    ).first()
    if existing:
        db.delete(existing)
        db.commit()

    strategy = ApprovalStrategies(
        popup_id=popup.id,
        tenant_id=tenant.id,
        strategy_type=strategy_type,
        required_approvals=required_approvals,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


def _add_popup_reviewer(
    db: Session,
    popup: Popups,
    tenant: Tenants,
    user: Users,
    *,
    is_required: bool = True,
) -> PopupReviewers:
    """Designate a user as a required reviewer for a popup."""
    reviewer = PopupReviewers(
        popup_id=popup.id,
        user_id=user.id,
        tenant_id=tenant.id,
        is_required=is_required,
    )
    db.add(reviewer)
    db.commit()
    db.refresh(reviewer)
    return reviewer


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestApprovalTransitions:
    """Integration tests for all 10 application approval state-machine paths."""

    # ------------------------------------------------------------------
    # Test 1: No strategy → AUTO_ACCEPT on portal submit → ACCEPTED
    # ------------------------------------------------------------------
    def test_1_portal_submit_no_strategy_auto_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Portal submit with no approval strategy → application immediately ACCEPTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t1-no-strategy")
        # Ensure no strategy exists
        existing = db.exec(
            select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup.id)
        ).first()
        if existing:
            db.delete(existing)
            db.commit()

        email = f"t1-human-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "Human",
                "status": "in review",
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == ApplicationStatus.ACCEPTED.value
        assert data["accepted_at"] is not None

    # ------------------------------------------------------------------
    # Test 2: ANY_REVIEWER strategy → portal submit → IN_REVIEW
    # ------------------------------------------------------------------
    def test_2_portal_submit_any_reviewer_stays_in_review(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Portal submit with ANY_REVIEWER strategy → application stays IN_REVIEW."""
        popup = _make_popup(db, tenant_a, slug_suffix="t2-any-reviewer")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        email = f"t2-human-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "Human",
                "status": "in review",
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == ApplicationStatus.IN_REVIEW.value

    # ------------------------------------------------------------------
    # Test 3: Red-flagged human → portal submit → REJECTED
    # ------------------------------------------------------------------
    def test_3_portal_submit_red_flagged_human_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Portal submit from red-flagged human → auto-rejected regardless of strategy."""
        popup = _make_popup(db, tenant_a, slug_suffix="t3-red-flag")
        existing = db.exec(
            select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup.id)
        ).first()
        if existing:
            db.delete(existing)
            db.commit()

        email = f"t3-redflag-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email, red_flag=True)
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Red",
                "last_name": "Flag",
                "status": "in review",
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == ApplicationStatus.REJECTED.value
        assert data["accepted_at"] is None

    # ------------------------------------------------------------------
    # Test 4: PATCH draft→submit with AUTO_ACCEPT strategy → ACCEPTED
    # ------------------------------------------------------------------
    def test_4_patch_draft_to_submit_auto_accept(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PATCH draft→in review with AUTO_ACCEPT strategy → ACCEPTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t4-patch-auto")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )

        email = f"t4-human-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        create_resp = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "Human",
                "status": "draft",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        assert create_resp.json()["status"] == ApplicationStatus.DRAFT.value

        patch_resp = client.patch(
            f"/api/v1/applications/my/{popup.id}",
            headers={"Authorization": f"Bearer {human_token}"},
            json={"status": "in review"},
        )
        assert patch_resp.status_code == 200, patch_resp.text
        data = patch_resp.json()
        assert data["status"] == ApplicationStatus.ACCEPTED.value
        assert data["accepted_at"] is not None

    # ------------------------------------------------------------------
    # Test 5: PATCH draft→submit with ANY_REVIEWER strategy → IN_REVIEW
    # ------------------------------------------------------------------
    def test_5_patch_draft_to_submit_any_reviewer_stays_in_review(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """PATCH draft→in review with ANY_REVIEWER strategy → stays IN_REVIEW."""
        popup = _make_popup(db, tenant_a, slug_suffix="t5-patch-any")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        email = f"t5-human-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)
        human_token = create_access_token(subject=human.id, token_type="human")

        create_resp = client.post(
            "/api/v1/applications/my",
            headers={"Authorization": f"Bearer {human_token}"},
            json={
                "popup_id": str(popup.id),
                "first_name": "Test",
                "last_name": "Human",
                "status": "draft",
            },
        )
        assert create_resp.status_code == 201, create_resp.text

        patch_resp = client.patch(
            f"/api/v1/applications/my/{popup.id}",
            headers={"Authorization": f"Bearer {human_token}"},
            json={"status": "in review"},
        )
        assert patch_resp.status_code == 200, patch_resp.text
        data = patch_resp.json()
        assert data["status"] == ApplicationStatus.IN_REVIEW.value

    # ------------------------------------------------------------------
    # Test 6: ANY_REVIEWER + YES review → ACCEPTED
    # ------------------------------------------------------------------
    def test_6_review_yes_any_reviewer_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Submitting a YES review under ANY_REVIEWER strategy → ACCEPTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t6-yes-review")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        reviewer_email = f"t6-reviewer-{uuid.uuid4().hex[:8]}@test.com"
        reviewer = _make_reviewer_user(db, tenant_a, email=reviewer_email)
        reviewer_token = create_access_token(subject=reviewer.id, token_type="user")

        email = f"t6-applicant-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
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
        assert fresh_app.status == ApplicationStatus.ACCEPTED.value
        assert fresh_app.accepted_at is not None

    # ------------------------------------------------------------------
    # Test 7: ANY_REVIEWER + all required reviewers voted NO → REJECTED
    # ------------------------------------------------------------------
    def test_7_review_no_all_required_voted_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """All required reviewers voted NO under ANY_REVIEWER strategy → REJECTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t7-no-review")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        reviewer_email = f"t7-reviewer-{uuid.uuid4().hex[:8]}@test.com"
        reviewer = _make_reviewer_user(db, tenant_a, email=reviewer_email)
        reviewer_token = create_access_token(subject=reviewer.id, token_type="user")

        _add_popup_reviewer(db, popup, tenant_a, reviewer, is_required=True)

        email = f"t7-applicant-{uuid.uuid4().hex[:8]}@test.com"
        human = _make_human(db, tenant_a, email=email)

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
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
                "Authorization": f"Bearer {reviewer_token}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "no"},
        )
        assert response.status_code == 201, response.text

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.REJECTED.value

    # ------------------------------------------------------------------
    # Test 8: THRESHOLD(2) + 2 YES votes → ACCEPTED
    # ------------------------------------------------------------------
    def test_8_threshold_2_yes_votes_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """THRESHOLD strategy with required_approvals=2: two YES votes → ACCEPTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t8-threshold-yes")
        _set_strategy(
            db,
            popup,
            tenant_a,
            strategy_type=ApprovalStrategyType.THRESHOLD,
            required_approvals=2,
        )

        reviewer1 = _make_reviewer_user(
            db, tenant_a, email=f"t8-reviewer1-{uuid.uuid4().hex[:8]}@test.com"
        )
        reviewer2 = _make_reviewer_user(
            db, tenant_a, email=f"t8-reviewer2-{uuid.uuid4().hex[:8]}@test.com"
        )
        token1 = create_access_token(subject=reviewer1.id, token_type="user")
        token2 = create_access_token(subject=reviewer2.id, token_type="user")

        human = _make_human(
            db, tenant_a, email=f"t8-applicant-{uuid.uuid4().hex[:8]}@test.com"
        )

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)
        app_id = application.id

        resp1 = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {token1}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )
        assert resp1.status_code == 201, resp1.text

        db.expire_all()
        mid_app = db.exec(select(Applications).where(Applications.id == app_id)).first()
        assert mid_app is not None
        assert mid_app.status == ApplicationStatus.IN_REVIEW.value

        resp2 = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {token2}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )
        assert resp2.status_code == 201, resp2.text

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.ACCEPTED.value
        assert fresh_app.accepted_at is not None

    # ------------------------------------------------------------------
    # Test 9: THRESHOLD(2) + 1 YES, 1 NO (all designated voted) → REJECTED
    # ------------------------------------------------------------------
    def test_9_threshold_2_insufficient_yes_all_voted_rejected(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """THRESHOLD(2) with 2 required reviewers: 1 YES + 1 NO → REJECTED."""
        popup = _make_popup(db, tenant_a, slug_suffix="t9-threshold-no")
        _set_strategy(
            db,
            popup,
            tenant_a,
            strategy_type=ApprovalStrategyType.THRESHOLD,
            required_approvals=2,
        )

        reviewer1 = _make_reviewer_user(
            db, tenant_a, email=f"t9-reviewer1-{uuid.uuid4().hex[:8]}@test.com"
        )
        reviewer2 = _make_reviewer_user(
            db, tenant_a, email=f"t9-reviewer2-{uuid.uuid4().hex[:8]}@test.com"
        )
        token1 = create_access_token(subject=reviewer1.id, token_type="user")
        token2 = create_access_token(subject=reviewer2.id, token_type="user")

        _add_popup_reviewer(db, popup, tenant_a, reviewer1, is_required=True)
        _add_popup_reviewer(db, popup, tenant_a, reviewer2, is_required=True)

        human = _make_human(
            db, tenant_a, email=f"t9-applicant-{uuid.uuid4().hex[:8]}@test.com"
        )

        application = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(application)
        db.commit()
        db.refresh(application)
        app_id = application.id

        resp1 = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {token1}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "yes"},
        )
        assert resp1.status_code == 201, resp1.text

        resp2 = client.post(
            f"/api/v1/applications/{app_id}/reviews",
            headers={
                "Authorization": f"Bearer {token2}",
                "X-Tenant-Id": str(tenant_a.id),
            },
            json={"decision": "no"},
        )
        assert resp2.status_code == 201, resp2.text

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.REJECTED.value

    # ------------------------------------------------------------------
    # Test 10: Group leader adds existing IN_REVIEW member → ACCEPTED
    # ------------------------------------------------------------------
    def test_10_group_leader_adds_existing_member_accepted(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """Group leader adding an existing IN_REVIEW applicant → ACCEPTED + accepted_at set."""
        popup = _make_popup(db, tenant_a, slug_suffix="t10-group-accept")
        _set_strategy(
            db, popup, tenant_a, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )

        leader_email = f"t10-leader-{uuid.uuid4().hex[:8]}@test.com"
        leader = _make_human(db, tenant_a, email=leader_email)
        leader_token = create_access_token(subject=leader.id, token_type="human")

        group = Groups(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Test Group T10",
            slug=f"test-group-t10-{uuid.uuid4().hex[:8]}",
        )
        db.add(group)
        db.flush()

        group_leader_link = GroupLeaders(
            tenant_id=tenant_a.id,
            group_id=group.id,
            human_id=leader.id,
        )
        db.add(group_leader_link)
        db.commit()
        db.refresh(group)

        member_email = f"t10-member-{uuid.uuid4().hex[:8]}@test.com"
        member_human = _make_human(db, tenant_a, email=member_email)

        existing_app = Applications(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            human_id=member_human.id,
            status=ApplicationStatus.IN_REVIEW.value,
        )
        db.add(existing_app)
        db.commit()
        db.refresh(existing_app)
        app_id = existing_app.id

        response = client.post(
            f"/api/v1/groups/my/{group.id}/members",
            headers={"Authorization": f"Bearer {leader_token}"},
            json={
                "first_name": "Test",
                "last_name": "Member",
                "email": member_email,
            },
        )
        assert response.status_code == 201, response.text

        db.expire_all()
        fresh_app = db.exec(
            select(Applications).where(Applications.id == app_id)
        ).first()
        assert fresh_app is not None
        assert fresh_app.status == ApplicationStatus.ACCEPTED.value
        assert fresh_app.accepted_at is not None

        # Verify group membership was created
        member_link = db.exec(
            select(GroupMembers).where(
                GroupMembers.group_id == group.id,
                GroupMembers.human_id == member_human.id,
            )
        ).first()
        assert member_link is not None
