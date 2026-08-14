"""A flow chooses how its checkout looks.

Design: sdd/sales-flows-rediseno. `theme_config` lived only on the popup, so
every flow of a gathering sold under the same colours even though they
already differ in their steps, their form and their emails.

Scenarios:
- A new flow copies the gathering's theme, so nothing changes the day it is
  created.
- Restyling one flow leaves the gathering and every other flow alone.
- A flow with no theme of its own uses no overrides — it does NOT read the
  gathering's, which is the read-through this redesign removed everywhere.
- The checkout runtime reports the flow's theme, not the popup's.
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from tests._flow_helpers import seed_default_steps

WARM = {"colors": {"primary": "#b4423a"}}
COOL = {"colors": {"primary": "#2a7f8f"}}


def _make_popup(db: Session, tenant: Tenants, *, theme: dict | None = None) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Theme Popup {uuid.uuid4().hex[:6]}",
        slug=f"theme-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
        theme_config=theme,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


class TestCopyAtCreation:
    def test_a_new_flow_starts_from_the_gatherings_theme(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Nothing changes for a buyer on the day a flow is created."""
        popup = _make_popup(db, tenant_a, theme=WARM)

        flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="direct"
        )
        db.commit()
        db.refresh(flow)

        assert flow.theme_config == WARM

    def test_a_gathering_with_no_theme_gives_none(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, theme=None)

        flow = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="direct"
        )
        db.commit()
        db.refresh(flow)

        assert flow.theme_config is None


class TestIndependence:
    def _second_flow(self, db: Session, popup: Popups) -> SalesFlows:
        flow = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            type="direct",
            slug=f"second-{uuid.uuid4().hex[:8]}",
            name="Second",
        )
        db.add(flow)
        db.commit()
        db.refresh(flow)
        return flow

    def test_restyling_one_flow_leaves_the_others_alone(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, theme=WARM)
        first = sales_flows_crud.provision_default_flow(
            db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="direct"
        )
        db.commit()
        second = self._second_flow(db, popup)
        sales_flows_crud.seed_config(db, second, popup.id)
        db.commit()

        first.theme_config = COOL
        db.add(first)
        db.commit()
        db.refresh(second)
        db.refresh(popup)

        assert second.theme_config == WARM
        assert popup.theme_config == WARM

    def test_a_flow_without_a_theme_reads_no_overrides(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The read-through this redesign removed. An empty theme means no
        overrides, never "ask the gathering"."""
        popup = _make_popup(db, tenant_a, theme=WARM)
        bare = self._second_flow(db, popup)

        assert bare.theme_config is None


class TestCheckoutRuntime:
    def test_the_runtime_reports_the_flow_theme(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.checkout.crud import runtime_for_slug

        popup = _make_popup(db, tenant_a, theme=WARM)
        flow = seed_default_steps(db, popup, sale_type="direct")
        flow.theme_config = COOL
        db.add(flow)
        db.commit()

        runtime = runtime_for_slug(db, popup.slug, tenant_a.id)

        assert runtime.theme_config == COOL
        assert runtime.popup.theme_config == WARM, (
            "the gathering keeps its own for the portal pages outside checkout"
        )
