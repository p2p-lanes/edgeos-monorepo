"""Task 9.1 — sales_flow/resolver.py.

Design: sdd/sales-flows D2, the Flow-Resolution Contract table, and the
Threat Matrix's added "URL segment resolution" / "Cross-tenant / cross-popup
flow reference" rows.

TDD: RED -> GREEN. This file was created before app/api/sales_flow/resolver.py
existed (import at module scope fails until the module exists).
"""

import uuid

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow import resolver
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowType
from app.api.tenant.models import Tenants


def _make_popup(
    db: Session, tenant: Tenants, *, status: str = "active", sale_type: str = "direct"
) -> Popups:
    slug = f"resolver-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Resolver Popup {slug}",
        slug=slug,
        sale_type=sale_type,
        status=status,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    slug: str,
    is_default: bool = False,
    type: str = "direct",  # noqa: A002
    status: str | None = None,
    visibility: str = "portal_listed",
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        type=type,
        is_default=is_default,
        status=status,
        visibility=visibility,
    )
    db.add(flow)
    db.flush()
    return flow


class TestResolveFlowGateOrder:
    def test_missing_popup_raises_404(self, db: Session) -> None:
        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, None, None)
        assert exc_info.value.status_code == 404

    def test_none_slug_resolves_default_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        default_flow = _make_flow(db, popup, slug="checkout", is_default=True)
        db.commit()

        flow = resolver.resolve_flow(db, popup, None)
        assert flow.id == default_flow.id

    def test_none_slug_missing_default_raises_404(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, popup, None)
        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "Sales flow not found"

    def test_named_flow_resolves_without_a_default(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        named_flow = _make_flow(db, popup, slug="volunteers")
        db.commit()

        resolved = resolver.resolve_flow(db, popup, named_flow.slug)

        assert resolved.id == named_flow.id

    def test_unknown_slug_raises_404(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="checkout", is_default=True)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, popup, "does-not-exist")
        assert exc_info.value.status_code == 404

    def test_inactive_effective_status_raises_403(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, status="draft")
        flow = _make_flow(db, popup, slug="checkout", is_default=True)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, popup, flow.slug)
        assert exc_info.value.status_code == 403

    def test_flow_status_overrides_popup_status(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A flow's own `status` column (Class C, reserved) wins over the
        popup's when set — effective status = flow.status ?? popup.status."""
        popup = _make_popup(db, tenant_a, status="active")
        flow = _make_flow(db, popup, slug="paused", is_default=True, status="draft")
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, popup, flow.slug)
        assert exc_info.value.status_code == 403

    def test_require_types_mismatch_raises_403(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, sale_type="application")
        flow = _make_flow(
            db, popup, slug="attendee", is_default=True, type="application"
        )
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(
                db,
                popup,
                flow.slug,
                require_types={SalesFlowType.direct, SalesFlowType.upsale},
            )
        assert exc_info.value.status_code == 403

    def test_require_types_match_returns_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="checkout", is_default=True, type="direct")
        db.commit()

        resolved = resolver.resolve_flow(
            db,
            popup,
            flow.slug,
            require_types={SalesFlowType.direct, SalesFlowType.upsale},
        )
        assert resolved.id == flow.id

    def test_direct_url_only_flow_is_still_reachable_by_slug(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: visibility is listing-only, never an access gate."""
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="checkout", is_default=True)
        hidden = _make_flow(db, popup, slug="unlisted", visibility="direct_url_only")
        db.commit()

        resolved = resolver.resolve_flow(db, popup, hidden.slug)
        assert resolved.id == hidden.id

    def test_flow_of_another_popup_is_unreachable(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: cross-popup flow reference is blocked."""
        popup_a = _make_popup(db, tenant_a)
        popup_b = _make_popup(db, tenant_a)
        _make_flow(db, popup_a, slug="checkout", is_default=True)
        other_flow = _make_flow(db, popup_b, slug="only-on-b", is_default=True)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.resolve_flow(db, popup_a, other_flow.slug)
        assert exc_info.value.status_code == 404


class TestGetDefaultFlow:
    def test_returns_default_flow(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        default_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="direct"
        )
        db.commit()

        flow = resolver.get_default_flow(db, popup.id)
        assert flow.id == default_flow.id

    def test_missing_default_raises_404(self, db: Session, tenant_a: Tenants) -> None:
        popup = _make_popup(db, tenant_a)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            resolver.get_default_flow(db, popup.id)
        assert exc_info.value.status_code == 404
        assert exc_info.value.detail == "Sales flow not found"


class TestResolveActiveDirectFlow:
    """`db` is a session-scoped fixture (state persists across tests), so
    each case here needs its OWN tenant — mirrors
    tests/api/checkout/test_resolve_active_popup_slug.py's own isolation
    pattern for the exact same underlying query."""

    @pytest.fixture()
    def tenant(self, db: Session) -> Tenants:
        t = Tenants(
            name=f"Resolver Flow Tenant {uuid.uuid4().hex[:6]}",
            slug=f"resolver-flow-tenant-{uuid.uuid4().hex[:6]}",
        )
        db.add(t)
        db.commit()
        db.refresh(t)
        return t

    def test_returns_popup_and_default_flow_slug(
        self, db: Session, tenant: Tenants
    ) -> None:
        popup = _make_popup(db, tenant, status="active", sale_type="direct")
        default_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant.id, sale_type="direct"
        )
        db.commit()

        result = resolver.resolve_active_direct_flow(db, tenant.id)
        assert result == (popup.slug, default_flow.slug)

    def test_no_active_direct_popup_returns_none(
        self, db: Session, tenant: Tenants
    ) -> None:
        result = resolver.resolve_active_direct_flow(db, tenant.id)
        assert result is None

    def test_active_direct_popup_without_default_returns_none(
        self, db: Session, tenant: Tenants
    ) -> None:
        _make_popup(db, tenant, status="active", sale_type="direct")
        db.commit()

        result = resolver.resolve_active_direct_flow(db, tenant.id)

        assert result is None

    def test_earliest_start_date_wins(self, db: Session, tenant: Tenants) -> None:
        from datetime import UTC, datetime, timedelta

        later = _make_popup(db, tenant, status="active", sale_type="direct")
        later.start_date = datetime.now(UTC) + timedelta(days=10)
        earlier = _make_popup(db, tenant, status="active", sale_type="direct")
        earlier.start_date = datetime.now(UTC) + timedelta(days=1)
        db.add(later)
        db.add(earlier)
        earlier_flow = sales_flows_crud.provision_default_flow(
            db, popup_id=earlier.id, tenant_id=tenant.id, sale_type="direct"
        )
        sales_flows_crud.provision_default_flow(
            db, popup_id=later.id, tenant_id=tenant.id, sale_type="direct"
        )
        db.commit()

        result = resolver.resolve_active_direct_flow(db, tenant.id)
        assert result == (earlier.slug, earlier_flow.slug)


class TestBuildEffectiveConfig:
    """Pure, no I/O — the flow's own configuration, never the popup's.

    Since sdd/sales-flows-rediseno slice 7 a flow owns these columns: they
    are seeded from the popup at creation and read straight from the flow
    afterwards, so editing one flow cannot reach another.
    """

    def _popup(self, **overrides) -> Popups:
        base = {
            "tenant_id": uuid.uuid4(),
            "name": "P",
            "slug": "p",
            "application_layout": "single_page",
            "requires_application_fee": False,
            "application_fee_amount": None,
            "allows_scholarship": False,
            "allows_incentive": False,
            "allows_coupons": False,
            "open_checkout_success_url": None,
            "open_checkout_cancel_url": None,
            "open_checkout_signing_secret": None,
            "abandoned_cart_delay_days": 1,
            "abandoned_cart_repeat_days": 2,
            "abandoned_cart_max_count": 3,
            "purchase_reminder_delay_days": 4,
            "purchase_reminder_repeat_days": 5,
            "purchase_reminder_max_count": 6,
            "abandoned_application_delay_days": 7,
            "abandoned_application_repeat_days": 8,
            "abandoned_application_max_count": 9,
        }
        base.update(overrides)
        return Popups(**base)

    def _flow(self, popup: Popups, **overrides) -> SalesFlows:
        base = {
            "tenant_id": popup.tenant_id,
            "popup_id": uuid.uuid4(),
            "slug": "f",
            "name": "F",
        }
        base.update(overrides)
        return SalesFlows(**base)

    def test_reads_the_flows_own_values(self) -> None:
        popup = self._popup(abandoned_cart_delay_days=42, allows_coupons=False)
        flow = self._flow(popup, abandoned_cart_delay_days=7, allows_coupons=True)

        config = resolver.build_effective_config(flow, popup)

        assert config.abandoned_cart_delay_days == 7
        assert config.allows_coupons is True

    def test_the_popup_no_longer_shows_through(self) -> None:
        """The removed inheritance: a popup value must not reappear when the
        flow's own column is unset."""
        popup = self._popup(abandoned_cart_delay_days=42, allows_coupons=True)
        flow = self._flow(popup)

        config = resolver.build_effective_config(flow, popup)

        assert config.abandoned_cart_delay_days is None
        assert config.allows_coupons is None

    def test_false_is_a_value_not_an_absence(self) -> None:
        """NULL vs False must not be conflated: an explicit False stays
        False rather than being read as unset."""
        popup = self._popup(requires_application_fee=True)
        flow = self._flow(popup, requires_application_fee=False)

        config = resolver.build_effective_config(flow, popup)

        assert config.requires_application_fee is False

    def test_zero_is_a_value_not_an_absence(self) -> None:
        popup = self._popup(abandoned_cart_max_count=5)
        flow = self._flow(popup, abandoned_cart_max_count=0)

        config = resolver.build_effective_config(flow, popup)

        assert config.abandoned_cart_max_count == 0
