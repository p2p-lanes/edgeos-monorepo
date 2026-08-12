"""A new flow starts as a copy of the one already selling.

Design: sdd/sales-flows-rediseno R3 — copy, do not inherit. The channel
configuration (coupon toggle, checkout redirects, reminder cadences) used to
be seeded from the popup's own copies of those columns. Those columns are no
longer editable anywhere: the backoffice offers them per flow, which is what
`d4f1a72e9c85` said had to happen before they could be dropped. Seeding from
them would mean every flow made from now on starts blank.

So a new flow copies the popup's default flow, the one an operator has
actually been configuring. Only the default flow itself has no sibling, and
it alone still falls back to the popup.
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.schemas import SalesFlowCreate
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Seed Popup {uuid.uuid4().hex[:6]}",
        slug=f"seed-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _default_flow(db: Session, popup: Popups):
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=popup.tenant_id, sale_type="direct"
    )
    db.commit()
    db.refresh(flow)
    return flow


def _create_flow(db: Session, popup: Popups, *, slug: str):
    return sales_flows_crud.create(
        db,
        obj_in=SalesFlowCreate(
            popup_id=popup.id,
            slug=slug,
            name=slug,
            type=SaleType.direct.value,
        ),
        tenant_id=popup.tenant_id,
    )


class TestSeedsFromTheDefaultFlow:
    def test_a_second_flow_copies_what_the_default_flow_was_configured_with(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        default = _default_flow(db, popup)
        default.abandoned_cart_delay_days = 4
        default.abandoned_cart_repeat_days = 2
        default.allows_coupons = True
        default.open_checkout_success_url = "https://event.example.com/thanks"
        db.add(default)
        db.commit()

        second = _create_flow(db, popup, slug=f"second-{uuid.uuid4().hex[:6]}")

        assert second.abandoned_cart_delay_days == 4
        assert second.abandoned_cart_repeat_days == 2
        assert second.allows_coupons is True
        assert second.open_checkout_success_url == "https://event.example.com/thanks"

    def test_the_copy_is_taken_once_and_never_read_through(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Restyling the default flow afterwards leaves the copy alone."""
        popup = _make_popup(db, tenant_a)
        default = _default_flow(db, popup)
        default.abandoned_cart_delay_days = 4
        db.add(default)
        db.commit()

        second = _create_flow(db, popup, slug=f"frozen-{uuid.uuid4().hex[:6]}")

        default.abandoned_cart_delay_days = 30
        db.add(default)
        db.commit()
        db.refresh(second)

        assert second.abandoned_cart_delay_days == 4

    def test_an_explicit_value_beats_the_sibling(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        default = _default_flow(db, popup)
        default.abandoned_cart_delay_days = 4
        db.add(default)
        db.commit()

        explicit = sales_flows_crud.create(
            db,
            obj_in=SalesFlowCreate(
                popup_id=popup.id,
                slug=f"explicit-{uuid.uuid4().hex[:6]}",
                name="Explicit",
                type=SaleType.direct.value,
                abandoned_cart_delay_days=9,
            ),
            tenant_id=tenant_a.id,
        )

        assert explicit.abandoned_cart_delay_days == 9


class TestTheDefaultFlowItself:
    def test_it_falls_back_to_the_popup_having_no_sibling(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The one flow created alongside its popup, with nothing to copy."""
        popup = _make_popup(db, tenant_a)
        popup.abandoned_cart_delay_days = 7
        db.add(popup)
        db.commit()

        default = _default_flow(db, popup)

        assert default.abandoned_cart_delay_days == 7

    def test_reprovisioning_returns_the_same_flow_untouched(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Idempotency: it must not try to seed itself from itself."""
        popup = _make_popup(db, tenant_a)
        first = _default_flow(db, popup)
        first.abandoned_cart_delay_days = 5
        db.add(first)
        db.commit()

        again = _default_flow(db, popup)

        assert again.id == first.id
        assert again.abandoned_cart_delay_days == 5
