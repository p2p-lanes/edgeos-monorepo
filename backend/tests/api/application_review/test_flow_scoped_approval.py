"""Tests for flow-scoped approval strategy + reviewer resolution feeding the
approval calculator (sdd/sales-flows slice 7, task 7.2).

`ApprovalCalculator.calculate_status` itself is UNCHANGED (design D4) — it
still only consumes `is_required` off a pre-resolved `designated_reviewers`
list. The resolution layer that FEEDS it (`recalculate_status`) now reads
`application.sales_flow_id` and resolves the strategy/reviewers through
that flow instead of always the popup tier.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.application_review.crud import application_reviews_crud
from app.api.application_review.schemas import ApplicationReviewCreate, ReviewDecision
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType
from app.api.human.models import Humans
from app.api.popup_reviewer.crud import popup_reviewers_crud
from app.api.popup_reviewer.models import PopupReviewers
from app.api.popup_reviewer.schemas import PopupReviewerCreate
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowReviewersMode
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token
from app.services.approval.calculator import approval_calculator
from tests._flow_helpers import default_flow_id


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup_via_api(client: TestClient, admin_token: str) -> uuid.UUID:
    """Fresh popup via the real create path — auto-provisions a default
    flow (task 5.0)."""
    unique = uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/popups",
        headers=_headers(admin_token),
        json={"name": f"Flow Approval Test {unique}"},
    )
    assert resp.status_code == 201, resp.text
    return uuid.UUID(resp.json()["id"])


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"flow-approval-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session, tenant: Tenants, popup_id: uuid.UUID, human: Humans, sales_flow_id
) -> Applications:
    app = Applications(
        tenant_id=tenant.id,
        popup_id=popup_id,
        human_id=human.id,
        sales_flow_id=sales_flow_id,
        status=ApplicationStatus.IN_REVIEW.value,
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def _make_second_flow(db: Session, tenant: Tenants, popup_id: uuid.UUID) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=popup_id,
        slug=f"upsale-flow-{uuid.uuid4().hex[:8]}",
        name="Second Flow",
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _set_strategy(
    db: Session,
    tenant: Tenants,
    popup_id: uuid.UUID,
    *,
    strategy_type: ApprovalStrategyType,
    sales_flow_id: uuid.UUID | None = None,
) -> ApprovalStrategies:
    """Create or replace a flow's strategy. Omitting `sales_flow_id` means
    the popup's default flow — there is no shared tier since slice 6, and
    popup creation already seeds an AUTO_ACCEPT row there, so it must be
    replaced rather than duplicated."""
    if sales_flow_id is None:
        sales_flow_id = default_flow_id(db, popup_id)
    filters = [
        ApprovalStrategies.popup_id == popup_id,
        ApprovalStrategies.sales_flow_id == sales_flow_id,
    ]
    existing = db.exec(select(ApprovalStrategies).where(*filters)).first()
    if existing:
        db.delete(existing)
        db.commit()

    strategy = ApprovalStrategies(
        tenant_id=tenant.id,
        popup_id=popup_id,
        sales_flow_id=sales_flow_id,
        strategy_type=strategy_type,
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


def _make_user(db: Session, tenant: Tenants) -> Users:
    user = Users(
        email=f"flow-approval-reviewer-{uuid.uuid4().hex[:8]}@test.com",
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestRecalculateStatusResolvesThroughApplicationFlow:
    def test_flow_owned_strategy_overrides_popup_shared_auto_accept(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        assert default_flow is not None

        second_flow = _make_second_flow(db, tenant_a, popup_id)
        _set_strategy(
            db, tenant_a, popup_id, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )
        _set_strategy(
            db,
            tenant_a,
            popup_id,
            strategy_type=ApprovalStrategyType.ALL_REVIEWERS,
            sales_flow_id=second_flow.id,
        )
        reviewer_user = _make_user(db, tenant_a)
        db.add(
            PopupReviewers(
                tenant_id=tenant_a.id,
                popup_id=popup_id,
                sales_flow_id=second_flow.id,
                user_id=reviewer_user.id,
                is_required=True,
            )
        )
        db.commit()

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, second_flow.id)

        updated = approval_calculator.recalculate_status(db, application)

        assert updated.status == ApplicationStatus.IN_REVIEW.value, (
            "The flow's own ALL_REVIEWERS strategy must be used instead of "
            "the popup-shared AUTO_ACCEPT strategy"
        )

    def test_default_flow_falls_back_to_popup_shared_strategy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        assert default_flow is not None

        _set_strategy(
            db, tenant_a, popup_id, strategy_type=ApprovalStrategyType.AUTO_ACCEPT
        )

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, default_flow.id)

        updated = approval_calculator.recalculate_status(db, application)

        assert updated.status == ApplicationStatus.ACCEPTED.value, (
            "The default flow owns no strategy of its own — must fall "
            "back to the popup-shared tier"
        )

    def test_flow_override_reviewers_mode_excludes_popup_reviewers_from_rejection(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """A flow in 'override' mode with zero of its own reviewers must
        never reject based on the popup's required reviewers — those are
        not part of this flow's designated set at all."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        second_flow = _make_second_flow(db, tenant_a, popup_id)
        sales_flows_crud.ensure_reviewers_override(db, second_flow.id)
        assert (
            sales_flows_crud.get(db, second_flow.id).reviewers_mode
            == SalesFlowReviewersMode.override
        )

        _set_strategy(
            db, tenant_a, popup_id, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )
        popup_reviewer_user = _make_user(db, tenant_a)
        db.add(
            PopupReviewers(
                tenant_id=tenant_a.id,
                popup_id=popup_id,
                user_id=popup_reviewer_user.id,
                is_required=True,
            )
        )
        db.commit()

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, second_flow.id)

        updated = approval_calculator.recalculate_status(db, application)

        assert updated.status == ApplicationStatus.IN_REVIEW.value, (
            "With zero flow-tier reviewers, required_reviewer_ids resolves "
            "empty for this flow — the popup's required reviewer must "
            "never trigger an auto-rejection on this flow's application"
        )


class TestSubmitReviewOverrideTierExclusivity:
    """risk-001: on an override-mode flow, only that flow's own reviewers
    may submit a vote. Inherit-mode flows (and legacy flow-less
    applications) keep today's unrestricted behavior (G1)."""

    def test_non_flow_reviewer_gets_403_on_override_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        second_flow = _make_second_flow(db, tenant_a, popup_id)
        sales_flows_crud.ensure_reviewers_override(db, second_flow.id)

        # A popup-shared reviewer is NOT on this flow's own reviewer list.
        popup_reviewer_user = _make_user(db, tenant_a)
        popup_reviewers_crud.create_reviewer(
            db,
            popup_id,
            tenant_a.id,
            PopupReviewerCreate(user_id=popup_reviewer_user.id),
        )
        outsider_token = create_access_token(
            subject=popup_reviewer_user.id, token_type="user"
        )

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, second_flow.id)

        resp = client.post(
            f"/api/v1/applications/{application.id}/reviews",
            headers=_headers(outsider_token),
            json={"decision": "yes"},
        )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "You are not a reviewer for this sales flow"

    def test_flow_tier_reviewer_can_vote_on_override_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        second_flow = _make_second_flow(db, tenant_a, popup_id)

        flow_reviewer_user = _make_user(db, tenant_a)
        popup_reviewers_crud.create_reviewer(
            db,
            popup_id,
            tenant_a.id,
            PopupReviewerCreate(
                user_id=flow_reviewer_user.id, sales_flow_id=second_flow.id
            ),
        )
        assert (
            sales_flows_crud.get(db, second_flow.id).reviewers_mode
            == SalesFlowReviewersMode.override
        )
        flow_reviewer_token = create_access_token(
            subject=flow_reviewer_user.id, token_type="user"
        )

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, second_flow.id)

        resp = client.post(
            f"/api/v1/applications/{application.id}/reviews",
            headers=_headers(flow_reviewer_token),
            json={"decision": "yes"},
        )

        assert resp.status_code == 201, resp.text

    def test_plain_operator_can_still_vote_on_inherit_mode_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Regression guard: the default flow stays 'inherit' — any
        operator can vote, exactly as before this gate was added (G1)."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        assert default_flow is not None
        assert default_flow.reviewers_mode == SalesFlowReviewersMode.inherit

        plain_operator = _make_user(db, tenant_a)
        plain_operator_token = create_access_token(
            subject=plain_operator.id, token_type="user"
        )

        human = _make_human(db, tenant_a)
        application = _make_application(db, tenant_a, popup_id, human, default_flow.id)

        resp = client.post(
            f"/api/v1/applications/{application.id}/reviews",
            headers=_headers(plain_operator_token),
            json={"decision": "yes"},
        )

        assert resp.status_code == 201, resp.text


class TestStaleVoteExcludedOnModeFlip:
    """calculator-001: create_reviewer auto-flips a flow's reviewers_mode to
    'override' on its first flow-tier add. A vote cast before that flip by a
    reviewer outside the resolved designated set must not count (G1)."""

    def _setup(self, db: Session, tenant: Tenants, popup_id: uuid.UUID):
        default_flow = sales_flows_crud.get_default_flow(db, popup_id)
        assert default_flow is not None
        _set_strategy(
            db, tenant, popup_id, strategy_type=ApprovalStrategyType.ANY_REVIEWER
        )
        operator = _make_user(db, tenant)
        human = _make_human(db, tenant)
        application = _make_application(db, tenant, popup_id, human, default_flow.id)
        application_reviews_crud.create_review(
            db,
            application.id,
            operator.id,
            tenant.id,
            ApplicationReviewCreate(decision=ReviewDecision.YES),
        )
        return default_flow, application

    def test_pre_flip_vote_excluded_after_override_flip(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        default_flow, application = self._setup(db, tenant_a, popup_id)

        flow_reviewer = _make_user(db, tenant_a)
        popup_reviewers_crud.create_reviewer(
            db,
            popup_id,
            tenant_a.id,
            PopupReviewerCreate(
                user_id=flow_reviewer.id, sales_flow_id=default_flow.id
            ),
        )
        assert (
            sales_flows_crud.get(db, default_flow.id).reviewers_mode
            == SalesFlowReviewersMode.override
        )

        updated = approval_calculator.recalculate_status(db, application)

        assert updated.status == ApplicationStatus.IN_REVIEW.value, (
            "The pre-flip vote was cast by a reviewer outside the flow's "
            "designated set after the override flip - it must not count"
        )

    def test_same_vote_counts_without_the_flip(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """Inherit-mode regression: unfiltered behavior is unchanged."""
        popup_id = _create_popup_via_api(client, admin_token_tenant_a)
        _default_flow, application = self._setup(db, tenant_a, popup_id)

        updated = approval_calculator.recalculate_status(db, application)

        assert updated.status == ApplicationStatus.ACCEPTED.value
