"""Choosing where a new way in starts, instead of always copying the same one.

Every flow used to begin as a copy of whichever door the gathering already
sells through, whether or not that made sense. Someone opening a volunteers
door on an event with a partner door inherited a five percent contribution, a
six-month installment plan and a refusal of coupons, and had to notice each one
to undo it.

`start_from` lets them say: the defaults for this kind of door (`fresh`),
nothing at all (`empty`), or a specific door worth copying. Omitting it keeps
the old behaviour exactly, so no client that has not moved changes what it
produces.

docs/sales-flows-templates.md, slice 2.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.templates import FLOW_TEMPLATES, TEMPLATABLE_FIELDS
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _popup(db: Session, tenant: Tenants, name: str = "Start") -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"{name} {uuid.uuid4().hex[:6]}",
        slug=f"start-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _flow(db: Session, popup: Popups, flow_type: str, **config) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=config.pop("slug", f"flow-{uuid.uuid4().hex[:8]}"),
        name=config.pop("name", "A way in"),
        type=flow_type,
        **config,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _seed(
    db: Session, popup: Popups, flow_type: str, start_from: str | None
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=f"new-{uuid.uuid4().hex[:8]}",
        name="New way in",
        type=flow_type,
    )
    sales_flows_crud.seed_config(db, flow, popup.id, start_from=start_from)
    return flow


def _partner_default(db: Session, popup: Popups) -> SalesFlows:
    """A door with opinions, so inheriting it is visibly a choice."""
    return _flow(
        db,
        popup,
        SaleType.direct.value,
        slug="default",
        name="Checkout",
        is_default=True,
        allows_coupons=False,
        contribution_enabled=True,
        contribution_percentage=5,
        contribution_label="Community fund",
        installments_enabled=True,
        installments_max=6,
    )


class TestTemplatesAreWellFormed:
    def test_every_template_names_real_settings(self) -> None:
        """A typo here is a default that silently never applies."""
        for flow_type, template in FLOW_TEMPLATES.items():
            unknown = set(template.values) - TEMPLATABLE_FIELDS
            assert not unknown, f"{flow_type} names non-settings: {unknown}"

    def test_a_template_only_sets_what_its_kind_can_read(self) -> None:
        from app.api.sales_flow.schemas import fields_for

        for flow_type, template in FLOW_TEMPLATES.items():
            allowed = set(fields_for(flow_type))
            assert set(template.values) <= allowed

    def test_no_template_charges_money_or_sends_email(self) -> None:
        """The rule that keeps these thin. A default nobody asked for must not
        bill a buyer or mail an applicant."""
        forbidden = {
            "insurance_enabled",
            "contribution_enabled",
            "installments_enabled",
            "requires_application_fee",
            "abandoned_cart_delay_days",
            "purchase_reminder_delay_days",
            "abandoned_application_delay_days",
        }
        for flow_type, template in FLOW_TEMPLATES.items():
            assert not (set(template.values) & forbidden), flow_type


class TestStartingFresh:
    def test_fresh_ignores_the_door_already_selling(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The whole point. A volunteers door does not want a partner's fees."""
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)

        flow = _seed(db, popup, SaleType.application.value, "fresh")

        assert flow.contribution_enabled is None
        assert flow.contribution_label is None
        assert flow.installments_enabled is None
        assert flow.installments_max is None

    def test_fresh_still_brings_its_own_kind_of_defaults(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)

        flow = _seed(db, popup, SaleType.application.value, "fresh")

        assert flow.application_layout == "multi_step"
        assert flow.allows_coupons is True

    def test_empty_brings_nothing_at_all(self, db: Session, tenant_a: Tenants) -> None:
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)

        flow = _seed(db, popup, SaleType.application.value, "empty")

        assert flow.application_layout is None
        assert flow.allows_coupons is None
        assert flow.contribution_enabled is None


class TestCopyingAChosenDoor:
    def test_it_copies_the_door_that_was_named(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        _flow(db, popup, SaleType.application.value, slug="default", is_default=True)
        scholarship = _flow(
            db,
            popup,
            SaleType.application.value,
            name="Scholarship",
            requires_application_fee=True,
            application_fee_amount=25,
            allows_scholarship=True,
        )

        flow = _seed(db, popup, SaleType.application.value, str(scholarship.id))

        assert flow.requires_application_fee is True
        assert flow.application_fee_amount == 25
        assert flow.allows_scholarship is True

    def test_copying_across_kinds_still_drops_what_cannot_be_read(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        _flow(db, popup, SaleType.application.value, slug="default", is_default=True)
        partner = _flow(
            db,
            popup,
            SaleType.direct.value,
            name="Sponsors",
            open_checkout_signing_secret="the-key-that-signs-orders",
            contribution_enabled=True,
            contribution_label="Community fund",
        )

        flow = _seed(db, popup, SaleType.application.value, str(partner.id))

        # The reason someone copies a partner door: its terms.
        assert flow.contribution_enabled is True
        assert flow.contribution_label == "Community fund"
        # And the reason the copy has to be narrowed.
        assert flow.open_checkout_signing_secret is None


class TestAnotherGatheringIsOutOfReach:
    def test_it_refuses_a_flow_from_a_different_popup(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Without the popup scoping, `start_from` copies any flow whose id you
        can name — including another gathering's signing secret, which is the
        key an external thank-you page verifies orders against."""
        mine = _popup(db, tenant_a, "Mine")
        _flow(db, mine, SaleType.application.value, slug="default", is_default=True)

        theirs = _popup(db, tenant_a, "Theirs")
        stranger = _flow(
            db,
            theirs,
            SaleType.direct.value,
            name="Their partner door",
            open_checkout_signing_secret="not-yours-to-read",
        )

        with pytest.raises(ValueError):
            _seed(db, mine, SaleType.direct.value, str(stranger.id))

    def test_it_refuses_something_that_is_not_an_id(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a)
        _flow(db, popup, SaleType.application.value, slug="default", is_default=True)

        with_bad_value = pytest.raises(ValueError)
        with with_bad_value:
            _seed(db, popup, SaleType.application.value, "the-checkout-template")


class TestOmittingItChangesNothing:
    def test_no_start_from_still_copies_the_door_already_selling(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Every existing API client's path. It must produce what it always
        produced."""
        popup = _popup(db, tenant_a)
        source = _partner_default(db, popup)

        flow = _seed(db, popup, SaleType.direct.value, None)

        assert flow.allows_coupons == source.allows_coupons
        assert flow.contribution_enabled == source.contribution_enabled
        assert flow.contribution_label == source.contribution_label
        assert flow.installments_max == source.installments_max


class TestThePreviewMatchesWhatYouGet:
    """The test that protects somebody who cannot read the code.

    A preview is the only tool a non-technical organiser has for understanding
    what they are about to do. One that disagrees with reality is worse than
    none, because it is confidently wrong.
    """

    def _preview(self, client: TestClient, token: str, popup: Popups, **params) -> dict:
        resp = client.get(
            "/api/v1/sales-flows/preview",
            headers={"Authorization": f"Bearer {token}"},
            params={"popup_id": str(popup.id), **params},
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    @pytest.mark.parametrize("start_from", ["fresh", "empty", None])
    def test_the_preview_is_what_creation_produces(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
        start_from: str | None,
    ) -> None:
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)

        params = {"type": "application"}
        if start_from is not None:
            params["start_from"] = start_from
        body = self._preview(client, admin_token_tenant_a, popup, **params)

        flow = _seed(db, popup, SaleType.application.value, start_from)

        for name, promised in body["starts_with"].items():
            actual = getattr(flow, name)
            assert str(actual) == str(promised), name
        for name in body["left_empty"]:
            assert getattr(flow, name) is None, name

    def test_it_names_what_will_not_be_carried_over(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)
        partner = _flow(
            db,
            popup,
            SaleType.direct.value,
            name="Sponsors",
            open_checkout_signing_secret="the-key-that-signs-orders",
        )

        body = self._preview(
            client,
            admin_token_tenant_a,
            popup,
            type="application",
            start_from=str(partner.id),
        )

        assert "open_checkout_signing_secret" in body["not_carried_over"]
        assert body["source_name"] == "Sponsors"
        assert body["source_kind"] == "flow"

    def test_it_never_leaks_a_secret_it_would_not_copy(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        """`not_carried_over` is a list of names, never of values."""
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)
        partner = _flow(
            db,
            popup,
            SaleType.direct.value,
            name="Sponsors",
            open_checkout_signing_secret="the-key-that-signs-orders",
        )

        resp = client.get(
            "/api/v1/sales-flows/preview",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            params={
                "popup_id": str(popup.id),
                "type": "application",
                "start_from": str(partner.id),
            },
        )

        assert "the-key-that-signs-orders" not in resp.text

    def test_a_flow_from_another_gathering_is_refused(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        mine = _popup(db, tenant_a, "Mine")
        _flow(db, mine, SaleType.application.value, slug="default", is_default=True)
        theirs = _popup(db, tenant_a, "Theirs")
        stranger = _flow(db, theirs, SaleType.direct.value, name="Theirs")

        resp = client.get(
            "/api/v1/sales-flows/preview",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            params={
                "popup_id": str(mine.id),
                "type": "direct",
                "start_from": str(stranger.id),
            },
        )

        assert resp.status_code == 422, resp.text


class TestCreatingThroughTheApi:
    def test_start_from_fresh_reaches_the_created_flow(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _popup(db, tenant_a)
        _partner_default(db, popup)

        resp = client.post(
            "/api/v1/sales-flows",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "popup_id": str(popup.id),
                "type": "application",
                "slug": f"volunteers-{uuid.uuid4().hex[:6]}",
                "name": "Volunteers",
                "start_from": "fresh",
            },
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["contribution_enabled"] is None
        assert body["application_layout"] == "multi_step"
