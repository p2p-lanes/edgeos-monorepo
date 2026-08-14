"""A way in is seeded with the settings its own kind can read, and no others.

A flow is born as a copy of whatever this popup already sells through. That
source can be a different kind of door entirely, and the copy did not care: it
walked all 33 of `EFFECTIVE_CONFIG_FIELDS` without once looking at the new
flow's type.

So an event selling directly, gaining a way in that people apply to, produced a
flow carrying the source's success URL, cancel URL and signing secret — none of
which an application flow ever reads — and carrying nothing at all for
applications, because a direct-sale source has none of that to give. The wrong
half arrived and the right half did not.

The signing secret is the one that matters most. It is the HMAC key an external
thank-you page verifies an order against, and it appeared, populated, on a
volunteers door that will never redirect anywhere. Nobody would report that.
They would assume the product is like that.

docs/sales-flows-templates.md, slice 1.
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    APPLICATION_ONLY_FIELDS,
    EFFECTIVE_CONFIG_FIELDS,
    SELLS_ONLY_FIELDS,
    fields_for,
)
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Seeding {uuid.uuid4().hex[:6]}",
        slug=f"seeding-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _default_flow(db: Session, popup: Popups, flow_type: str, **config) -> SalesFlows:
    """The way in this popup already sells through — the one copies come from."""
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug="default",
        name="Default",
        type=flow_type,
        is_default=True,
        **config,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _seed_new_flow(db: Session, popup: Popups, flow_type: str) -> SalesFlows:
    """Build a transient flow and run the seeding the create path runs."""
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"new-{uuid.uuid4().hex[:8]}",
        name="New way in",
        type=flow_type,
    )
    sales_flows_crud.seed_config(db, flow, popup.id)
    return flow


class TestFieldsForItsKind:
    def test_the_two_sets_name_real_columns(self) -> None:
        """A typo here silently un-filters a field, which is the failure mode
        this whole change exists to prevent."""
        named = APPLICATION_ONLY_FIELDS | SELLS_ONLY_FIELDS
        assert named <= set(EFFECTIVE_CONFIG_FIELDS), (
            f"not real settings: {named - set(EFFECTIVE_CONFIG_FIELDS)}"
        )

    def test_the_sets_do_not_overlap(self) -> None:
        assert not (APPLICATION_ONLY_FIELDS & SELLS_ONLY_FIELDS)

    def test_a_door_people_apply_to_keeps_its_own_settings(self) -> None:
        allowed = set(fields_for(SaleType.application.value))
        assert APPLICATION_ONLY_FIELDS <= allowed
        assert not (SELLS_ONLY_FIELDS & allowed)

    @pytest.mark.parametrize("flow_type", ["direct", "upsale"])
    def test_a_door_that_sells_keeps_the_selling_settings(self, flow_type: str) -> None:
        allowed = set(fields_for(flow_type))
        assert SELLS_ONLY_FIELDS <= allowed
        assert not (APPLICATION_ONLY_FIELDS & allowed)

    def test_everything_else_belongs_to_every_kind(self) -> None:
        """Fees, installments, coupons, invites and cart reminders are not
        type-bound, and quietly dropping one would be a regression nobody
        notices until an organiser's contribution stops being copied."""
        shared = (
            set(EFFECTIVE_CONFIG_FIELDS) - APPLICATION_ONLY_FIELDS - SELLS_ONLY_FIELDS
        )
        for flow_type in ("application", "direct", "upsale"):
            assert shared <= set(fields_for(flow_type))


class TestSeedingAcrossKinds:
    def test_an_application_door_does_not_inherit_a_signing_secret(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The reported case. A popup selling directly gains a way in people
        apply to, and the source's HMAC key came along for the ride."""
        popup = _popup(db, tenant_a)
        _default_flow(
            db,
            popup,
            SaleType.direct.value,
            open_checkout_success_url="https://partner.example.com/thanks",
            open_checkout_cancel_url="https://partner.example.com/cancel",
            open_checkout_signing_secret="the-key-that-signs-orders",
        )

        flow = _seed_new_flow(db, popup, SaleType.application.value)

        assert flow.open_checkout_signing_secret is None
        assert flow.open_checkout_success_url is None
        assert flow.open_checkout_cancel_url is None

    @pytest.mark.parametrize("flow_type", ["direct", "upsale"])
    def test_a_selling_door_does_not_inherit_application_settings(
        self, db: Session, tenant_a: Tenants, flow_type: str
    ) -> None:
        """The mirror. Nobody applies through it, so a fee to apply and a
        scholarship toggle are settings that can never run."""
        popup = _popup(db, tenant_a)
        _default_flow(
            db,
            popup,
            SaleType.application.value,
            application_layout="multi_step",
            requires_application_fee=True,
            allows_scholarship=True,
            allows_incentive=True,
            abandoned_application_delay_days=3,
            abandoned_application_repeat_days=7,
            abandoned_application_max_count=2,
        )

        flow = _seed_new_flow(db, popup, flow_type)

        assert flow.application_layout is None
        assert flow.requires_application_fee is None
        assert flow.allows_scholarship is None
        assert flow.allows_incentive is None
        assert flow.abandoned_application_delay_days is None

    def test_what_both_kinds_share_still_crosses(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Narrowing the copy must not narrow it too far. A partner's terms
        are worth inheriting whichever kind of door you are opening."""
        popup = _popup(db, tenant_a)
        _default_flow(
            db,
            popup,
            SaleType.direct.value,
            allows_coupons=False,
            contribution_enabled=True,
            contribution_label="Community fund",
            installments_enabled=True,
            installments_max=6,
            invites_enabled=True,
            abandoned_cart_delay_days=1,
        )

        flow = _seed_new_flow(db, popup, SaleType.application.value)

        assert flow.allows_coupons is False
        assert flow.contribution_enabled is True
        assert flow.contribution_label == "Community fund"
        assert flow.installments_enabled is True
        assert flow.installments_max == 6
        assert flow.invites_enabled is True
        assert flow.abandoned_cart_delay_days == 1


class TestSameKindIsUntouched:
    def test_copying_the_same_kind_of_door_is_bit_identical(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The safety property for every tenant already running.

        Their doors are all of one kind, so their creation path has no gap to
        close and must behave exactly as before. Asserted over the whole field
        list rather than a sample, because "we changed nothing" is only worth
        claiming if nothing is what was checked.
        """
        popup = _popup(db, tenant_a)
        source = _default_flow(
            db,
            popup,
            SaleType.application.value,
            application_layout="multi_step",
            requires_application_fee=True,
            allows_scholarship=True,
            allows_coupons=False,
            contribution_enabled=True,
            contribution_label="Community fund",
            installments_enabled=True,
            installments_max=6,
            checkin_pass_lead_days=2,
            abandoned_application_delay_days=3,
        )

        flow = _seed_new_flow(db, popup, SaleType.application.value)

        for name in EFFECTIVE_CONFIG_FIELDS:
            assert getattr(flow, name) == getattr(source, name), name

    def test_an_explicit_value_still_wins(self, db: Session, tenant_a: Tenants) -> None:
        popup = _popup(db, tenant_a)
        _default_flow(db, popup, SaleType.application.value, allows_coupons=True)

        flow = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug=f"explicit-{uuid.uuid4().hex[:8]}",
            name="Explicit",
            type=SaleType.application.value,
            allows_coupons=False,
        )
        sales_flows_crud.seed_config(db, flow, popup.id)

        assert flow.allows_coupons is False
