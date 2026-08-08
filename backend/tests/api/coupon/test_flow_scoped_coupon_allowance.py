"""Slice 11 — coupon allowance re-point (sdd/sales-flows design D2, task 11).

TDD phase: RED -> GREEN. Written before `coupon/crud.py::validate_public` and
`validate_coupon` read `allows_coupons` through the flow's `EffectiveFlowConfig`
and before `CouponValidatePublicRequest` accepts `flow_slug`.

Scenarios (binding standing rules for this slice):
1. Default flow with `allows_coupons=NULL` inherits the popup's value
   byte-identically (G5) — both the popup-scoped and public paths.
2/3. An explicit flow override (True or False) wins over the popup value,
   in both directions.
4. The anonymous `/coupons/validate-public` path resolves the named flow via
   `flow_slug` and enforces THAT flow's own type/status gates — proves
   per-flow, not just per-popup, resolution.
5. Coupon codes stay popup-scoped: the same code validates through every
   flow of its popup.
"""

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.coupon import crud as coupon_crud
from app.api.coupon.models import Coupons
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import coupon_flow_id

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sale_type_str(popup: Popups) -> str:
    return (
        popup.sale_type.value if hasattr(popup.sale_type, "value") else popup.sale_type
    )


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    allows_coupons: bool = True,
    sale_type: str = SaleType.direct.value,
) -> Popups:
    slug = f"flow-coupon-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Flow Coupon Popup {slug}",
        slug=slug,
        sale_type=sale_type,
        status="active",
        allows_coupons=allows_coupons,
    )
    db.add(popup)
    db.flush()
    return popup


def _provision_flow_returning(
    db: Session, popup: Popups, tenant: Tenants
) -> SalesFlows:
    flow = sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=tenant.id,
        sale_type=_sale_type_str(popup),
    )
    # Persisted before anything points a foreign key at it — coupons now do.
    db.commit()
    db.refresh(flow)
    return flow


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    slug: str,
    is_default: bool = False,
    type: str = SaleType.direct.value,  # noqa: A002
    allows_coupons: bool | None = None,
) -> SalesFlows:
    # A flow built directly here skips the copy `create` performs, and an
    # unset coupon setting means "no coupons" since slice 7 — so mirror what
    # creation would have done unless the test says otherwise.
    if allows_coupons is None:
        allows_coupons = popup.allows_coupons

    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        type=type,
        is_default=is_default,
        allows_coupons=allows_coupons,
    )
    db.add(flow)
    db.flush()
    return flow


def _make_coupon(
    db: Session,
    popup: Popups,
    *,
    code: str = "FLOWTEST",
    flow_id: uuid.UUID | None = None,
) -> Coupons:
    coupon = Coupons(
        sales_flow_id=flow_id or coupon_flow_id(db, popup.id),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        code=code.upper(),
        discount_value=15,
    )
    db.add(coupon)
    db.flush()
    return coupon


# ---------------------------------------------------------------------------
# coupon/crud.py::validate_coupon (portal, human-only, popup_id + optional flow_id)
# ---------------------------------------------------------------------------


class TestValidateCouponInheritance:
    def test_a_new_flow_starts_from_the_popups_setting(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Provisioning copies the popup's coupon setting into the flow
        (slice 7), so the day it is created nothing changes for a buyer."""
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        default_flow = _provision_flow_returning(db, popup, tenant_a)
        _make_coupon(db, popup, code="INHERITOK", flow_id=default_flow.id)
        db.commit()
        assert default_flow.allows_coupons is True, (
            "the copy happens at creation, not as a read-through"
        )

        coupon = coupon_crud.coupons_crud.validate_coupon(
            db, "INHERITOK", popup.id, default_flow.id
        )
        assert coupon.code == "INHERITOK"

    def test_a_new_flow_copies_a_disallowing_popup_too(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The other direction: a flow copied from a popup that disallows
        coupons still rejects them."""
        popup = _make_popup(db, tenant_a, allows_coupons=False)
        flow = _provision_flow_returning(db, popup, tenant_a)
        _make_coupon(db, popup, code="INHERITBAD", flow_id=flow.id)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            coupon_crud.coupons_crud.validate_coupon(
                db, "INHERITBAD", popup.id, flow.id
            )
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "Coupons are not enabled for this event"

    def test_flow_override_false_wins_over_popup_true(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        flow = _make_flow(
            db, popup, slug="default", is_default=True, allows_coupons=False
        )
        _make_coupon(db, popup, code="OVERRIDEOFF", flow_id=flow.id)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            coupon_crud.coupons_crud.validate_coupon(
                db, "OVERRIDEOFF", popup.id, flow.id
            )
        assert exc_info.value.status_code == 400

    def test_flow_override_true_wins_over_popup_false(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, allows_coupons=False)
        flow = _make_flow(
            db, popup, slug="default", is_default=True, allows_coupons=True
        )
        _make_coupon(db, popup, code="OVERRIDEON", flow_id=flow.id)
        db.commit()

        coupon = coupon_crud.coupons_crud.validate_coupon(
            db, "OVERRIDEON", popup.id, flow.id
        )
        assert coupon.code == "OVERRIDEON"


# ---------------------------------------------------------------------------
# coupon/router.py::validate_coupon_public (anonymous, popup_slug + optional
# flow_slug)
# ---------------------------------------------------------------------------


class TestValidatePublicFlowResolution:
    def test_public_default_flow_null_override_inherits_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        _provision_flow_returning(db, popup, tenant_a)
        _make_coupon(db, popup, code="PUBINHERIT")
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={"popup_slug": popup.slug, "code": "PUBINHERIT"},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        assert response.json()["valid"] is True

    def test_public_named_flow_slug_resolves_that_flow_override(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A second, non-default direct flow with its OWN allows_coupons=False
        rejects even though the popup and default flow both allow coupons —
        proves per-flow (not just per-popup) resolution."""
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        _provision_flow_returning(db, popup, tenant_a)
        secondary = _make_flow(
            db, popup, slug="vip", type=SaleType.direct.value, allows_coupons=False
        )
        _make_coupon(db, popup, code="VIPCODE")
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={
                "popup_slug": popup.slug,
                "code": "VIPCODE",
                "flow_slug": secondary.slug,
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid or expired coupon"

    def test_public_unknown_flow_slug_returns_uniform_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """An unknown `flow_slug` must not leak a 404 that would let an
        anonymous caller distinguish "no such flow" from "invalid coupon" —
        both collapse to the module's uniform 400."""
        popup = _make_popup(db, tenant_a)
        _provision_flow_returning(db, popup, tenant_a)
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={
                "popup_slug": popup.slug,
                "code": "ANY",
                "flow_slug": "does-not-exist",
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid or expired coupon"

    def test_public_application_type_flow_returns_uniform_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A flow of type=application is rejected even on an otherwise
        direct-sale popup — proves the type gate is FLOW-level, not just
        popup-level (the old `popup.sale_type` check alone would have missed
        this) — and the rejection stays the uniform 400, not a raw 403."""
        popup = _make_popup(db, tenant_a)
        _provision_flow_returning(db, popup, tenant_a)
        app_flow = _make_flow(db, popup, slug="apply", type=SaleType.application.value)
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={
                "popup_slug": popup.slug,
                "code": "ANY",
                "flow_slug": app_flow.slug,
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid or expired coupon"

    def test_public_popup_missing_default_flow_returns_uniform_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A popup that bypassed default-flow provisioning (pre-task-5.0
        data, or a direct DB insert) makes `resolve_flow` raise 500 — that
        must not leak to the anonymous caller either; it collapses to the
        same uniform 400 as every other failure state."""
        slug = f"flow-coupon-nodefault-{uuid.uuid4().hex[:8]}"
        popup = Popups(
            tenant_id=tenant_a.id,
            name=f"No Default Flow Popup {slug}",
            slug=slug,
            sale_type=SaleType.direct.value,
            status="active",
            allows_coupons=True,
        )
        db.add(popup)
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={"popup_slug": popup.slug, "code": "ANY"},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid or expired coupon"


# ---------------------------------------------------------------------------
# A coupon belongs to one flow (sdd/sales-flows-rediseno)
# ---------------------------------------------------------------------------


class TestCouponCodesBelongToOneFlow:
    def test_a_code_is_not_spendable_in_another_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Codes used to be found by (code, popup), so one written for a
        volunteer campaign was redeemable everywhere the gathering sold.

        `current_uses` counts a single row, so a code spanning two flows
        shared one allowance between them — "50 uses for volunteers" was
        never 50. A code wanted in two places is two coupons now, each
        counting its own.
        """
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        default_flow = _provision_flow_returning(db, popup, tenant_a)
        secondary = _make_flow(db, popup, slug="secondary", type=SaleType.direct.value)
        _make_coupon(db, popup, code="SHARED10", flow_id=default_flow.id)
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={"popup_slug": popup.slug, "code": "SHARED10"},
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={
                "popup_slug": popup.slug,
                "code": "SHARED10",
                "flow_slug": secondary.slug,
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid or expired coupon"

    def test_the_same_word_can_mean_a_different_discount(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, allows_coupons=True)
        default_flow = _provision_flow_returning(db, popup, tenant_a)
        secondary = _make_flow(db, popup, slug="secondary", type=SaleType.direct.value)
        cheap = _make_coupon(db, popup, code="EARLY", flow_id=default_flow.id)
        cheap.discount_value = 10
        generous = _make_coupon(db, popup, code="EARLY", flow_id=secondary.id)
        generous.discount_value = 40
        db.commit()

        response = client.post(
            "/api/v1/coupons/validate-public",
            json={
                "popup_slug": popup.slug,
                "code": "EARLY",
                "flow_slug": secondary.slug,
            },
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )

        assert response.status_code == 200, response.text
        # The public response serializes the discount as a string.
        assert int(response.json()["discount_value"]) == 40
