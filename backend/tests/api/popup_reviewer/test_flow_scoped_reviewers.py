"""Tests for flow-scoped reviewer resolution (sdd/sales-flows slice 7, D4).

Design D4: `sales_flows.reviewers_mode` (`inherit`|`override`) + nullable
`popup_reviewers.flow_id`. `resolve_for_flow(session, popup_id, flow_id)`:

- `flow_id=None` (no flow context) -> popup-shared tier (`flow_id IS NULL`).
- `reviewers_mode='inherit'` -> popup-shared tier.
- `reviewers_mode='override'` -> ONLY that flow's own rows; zero rows is a
  valid answer (no reviewers) — the popup tier never falls through.

CRUD invariant (enforced in `sales_flow` CRUD, not SQL, task 7.3): adding a
flow-tier reviewer sets `reviewers_mode='override'`; removing the last
flow-tier reviewer resets it to `inherit`.
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.popup_reviewer.crud import popup_reviewers_crud
from app.api.popup_reviewer.schemas import PopupReviewerCreate
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowVisibility,
)
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Reviewer Flow Popup {uuid.uuid4().hex[:8]}",
        slug=f"reviewer-flow-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    slug: str,
    reviewers_mode: SalesFlowReviewersMode = SalesFlowReviewersMode.inherit,
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=tenant.id,
        popup_id=popup.id,
        type="application",
        slug=slug,
        name=slug,
        visibility=SalesFlowVisibility.portal_listed,
        is_default=False,
        order=0,
        reviewers_mode=reviewers_mode,
        identity_mode=SalesFlowIdentityMode.portal_auth,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_user(db: Session, tenant: Tenants, *, email: str) -> Users:
    user = Users(email=email, role=UserRole.ADMIN, tenant_id=tenant.id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestResolveForFlowFallback:
    def test_none_flow_id_returns_popup_shared_reviewers(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        user = _make_user(db, tenant_a, email=f"rev-{popup.id.hex[:8]}@x.io")
        popup_reviewers_crud.create_reviewer(
            db, popup.id, tenant_a.id, PopupReviewerCreate(user_id=user.id)
        )

        resolved = popup_reviewers_crud.resolve_for_flow(db, popup.id, None)

        assert [r.user_id for r in resolved] == [user.id]

    def test_inherit_mode_returns_popup_shared_reviewers(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug="flow-a",
            reviewers_mode=SalesFlowReviewersMode.inherit,
        )
        user = _make_user(db, tenant_a, email=f"rev-{popup.id.hex[:8]}@x.io")
        popup_reviewers_crud.create_reviewer(
            db, popup.id, tenant_a.id, PopupReviewerCreate(user_id=user.id)
        )

        resolved = popup_reviewers_crud.resolve_for_flow(db, popup.id, flow.id)

        assert [r.user_id for r in resolved] == [user.id]


class TestResolveForFlowOverride:
    def test_override_mode_with_own_reviewers_excludes_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug="flow-override",
            reviewers_mode=SalesFlowReviewersMode.override,
        )
        popup_user = _make_user(db, tenant_a, email=f"popup-{popup.id.hex[:8]}@x.io")
        flow_user = _make_user(db, tenant_a, email=f"flow-{popup.id.hex[:8]}@x.io")
        popup_reviewers_crud.create_reviewer(
            db, popup.id, tenant_a.id, PopupReviewerCreate(user_id=popup_user.id)
        )
        popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=flow_user.id, flow_id=flow.id),
        )

        resolved = popup_reviewers_crud.resolve_for_flow(db, popup.id, flow.id)

        assert [r.user_id for r in resolved] == [flow_user.id], (
            "Explicit non-empty override must exclude the popup-shared tier"
        )

    def test_override_mode_with_zero_own_reviewers_returns_empty_not_popup_shared(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug="flow-empty-override",
            reviewers_mode=SalesFlowReviewersMode.override,
        )
        popup_user = _make_user(db, tenant_a, email=f"popup-{popup.id.hex[:8]}@x.io")
        popup_reviewers_crud.create_reviewer(
            db, popup.id, tenant_a.id, PopupReviewerCreate(user_id=popup_user.id)
        )

        resolved = popup_reviewers_crud.resolve_for_flow(db, popup.id, flow.id)

        assert resolved == [], (
            "Explicit empty override != absent — zero reviewers must never "
            "fall through to the popup tier once a flow overrides"
        )


class TestCreateReviewerInvariant:
    def test_adding_flow_tier_reviewer_sets_override_mode(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-toggle")
        assert flow.reviewers_mode == SalesFlowReviewersMode.inherit
        user = _make_user(db, tenant_a, email=f"rev-{popup.id.hex[:8]}@x.io")

        popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=user.id, flow_id=flow.id),
        )

        refreshed = sales_flows_crud.get(db, flow.id)
        assert refreshed is not None
        assert refreshed.reviewers_mode == SalesFlowReviewersMode.override

    def test_adding_popup_tier_reviewer_does_not_touch_flow_mode(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, tenant_a, popup, slug="flow-untouched")
        user = _make_user(db, tenant_a, email=f"rev-{popup.id.hex[:8]}@x.io")

        popup_reviewers_crud.create_reviewer(
            db, popup.id, tenant_a.id, PopupReviewerCreate(user_id=user.id)
        )

        refreshed = sales_flows_crud.get(db, flow.id)
        assert refreshed is not None
        assert refreshed.reviewers_mode == SalesFlowReviewersMode.inherit


class TestDeleteReviewerInvariant:
    def test_removing_last_flow_tier_reviewer_resets_inherit_mode(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug="flow-reset",
            reviewers_mode=SalesFlowReviewersMode.override,
        )
        user = _make_user(db, tenant_a, email=f"rev-{popup.id.hex[:8]}@x.io")
        reviewer = popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=user.id, flow_id=flow.id),
        )

        popup_reviewers_crud.delete_reviewer(db, reviewer)

        refreshed = sales_flows_crud.get(db, flow.id)
        assert refreshed is not None
        assert refreshed.reviewers_mode == SalesFlowReviewersMode.inherit

    def test_removing_one_of_two_flow_tier_reviewers_keeps_override_mode(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(
            db,
            tenant_a,
            popup,
            slug="flow-partial-remove",
            reviewers_mode=SalesFlowReviewersMode.override,
        )
        user_1 = _make_user(db, tenant_a, email=f"rev1-{popup.id.hex[:8]}@x.io")
        user_2 = _make_user(db, tenant_a, email=f"rev2-{popup.id.hex[:8]}@x.io")
        reviewer_1 = popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=user_1.id, flow_id=flow.id),
        )
        popup_reviewers_crud.create_reviewer(
            db,
            popup.id,
            tenant_a.id,
            PopupReviewerCreate(user_id=user_2.id, flow_id=flow.id),
        )

        popup_reviewers_crud.delete_reviewer(db, reviewer_1)

        refreshed = sales_flows_crud.get(db, flow.id)
        assert refreshed is not None
        assert refreshed.reviewers_mode == SalesFlowReviewersMode.override
