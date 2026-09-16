"""Which tier owns an email template, and what happens when it is empty.

Design: sdd/sales-flows-rediseno. Slice 6 deleted the popup tier on the
reading that every popup-scoped template belongs to a flow. Eleven of them
do. The other eight are sent by paths that have no sales flow to give — an
event invitation reaches everyone who is going, whatever they bought — so
deleting their tier stopped them resolving anything, silently.

Scenarios:
- A sale mail reads the flow tier, and one flow's wording never reaches
  another flow's buyer.
- A gathering mail reads the popup tier, which is what its sender can
  actually supply.
- Neither tier answers for the other, in either direction.
- A missing row means the template shipped with the product, never a
  sibling's customization.
- A row that fails to render does not take the mail down with it.
"""

import uuid

import pytest
from sqlmodel import Session

from app.api.email_template.models import EmailTemplates
from app.api.email_template.schemas import EmailTemplateType, TemplateScope
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.services.email.service import EmailService
from app.services.email.templates import get_template_scope

SALE_TYPE = EmailTemplateType.APPLICATION_ACCEPTED
GATHERING_TYPE = EmailTemplateType.EVENT_INVITATION


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Scope Popup {uuid.uuid4().hex[:6]}",
        slug=f"scope-{uuid.uuid4().hex[:8]}",
        status="active",
        currency="USD",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, popup: Popups) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type="application",
        slug=f"flow-{uuid.uuid4().hex[:8]}",
        name="Scope Flow",
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _make_template(
    db: Session,
    popup: Popups,
    *,
    template_type: EmailTemplateType,
    html: str,
    flow: SalesFlows | None = None,
    is_active: bool = True,
) -> EmailTemplates:
    template = EmailTemplates(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id if flow else None,
        template_type=template_type.value,
        html_content=html,
        is_active=is_active,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@pytest.fixture()
def service() -> EmailService:
    return EmailService()


class TestScopeAssignment:
    def test_a_sale_mail_belongs_to_the_flow(self) -> None:
        assert get_template_scope(SALE_TYPE) == TemplateScope.FLOW

    def test_a_gathering_mail_belongs_to_the_popup(self) -> None:
        """Its sender has no sales flow, so a flow tier could never hold it."""
        assert get_template_scope(GATHERING_TYPE) == TemplateScope.POPUP

    def test_a_login_code_belongs_to_the_tenant(self) -> None:
        assert (
            get_template_scope(EmailTemplateType.LOGIN_CODE_HUMAN)
            == TemplateScope.TENANT
        )


class TestFlowTier:
    def test_a_sale_mail_reads_its_own_flow(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_template(
            db, popup, template_type=SALE_TYPE, html="<p>From this flow</p>", flow=flow
        )

        html, _ = service.render_with_fallback(
            SALE_TYPE,
            {},
            popup_id=popup.id,
            sales_flow_id=flow.id,
            db_session=db,
        )

        assert "From this flow" in html

    def test_one_flow_wording_never_reaches_another(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        popup = _make_popup(db, tenant_a)
        loud = _make_flow(db, popup)
        quiet = _make_flow(db, popup)
        _make_template(
            db, popup, template_type=SALE_TYPE, html="<p>Loud wording</p>", flow=loud
        )

        html, _ = service.render_with_fallback(
            SALE_TYPE, {}, popup_id=popup.id, sales_flow_id=quiet.id, db_session=db
        )

        assert "Loud wording" not in html

    def test_a_popup_row_never_answers_for_a_flow(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        """The inheritance the redesign removed. A flow with no template of
        its own uses the shipped one, not the popup's."""
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_template(db, popup, template_type=SALE_TYPE, html="<p>Popup wording</p>")

        html, _ = service.render_with_fallback(
            SALE_TYPE, {}, popup_id=popup.id, sales_flow_id=flow.id, db_session=db
        )

        assert "Popup wording" not in html


class TestPopupTier:
    def test_a_gathering_mail_reads_the_popup(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        """The regression this repairs: with only a flow tier, this
        customization resolved nothing, because the sender has no flow."""
        popup = _make_popup(db, tenant_a)
        _make_template(
            db, popup, template_type=GATHERING_TYPE, html="<p>Come along</p>"
        )

        html, _ = service.render_with_fallback(
            GATHERING_TYPE, {}, popup_id=popup.id, db_session=db
        )

        assert "Come along" in html

    def test_it_resolves_without_any_flow_being_passed(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup)
        _make_template(db, popup, template_type=GATHERING_TYPE, html="<p>No flow</p>")

        html, _ = service.render_with_fallback(
            GATHERING_TYPE, {}, popup_id=popup.id, sales_flow_id=None, db_session=db
        )

        assert "No flow" in html

    def test_a_flow_row_never_answers_for_the_popup(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup)
        _make_template(
            db,
            popup,
            template_type=GATHERING_TYPE,
            html="<p>Flow wording</p>",
            flow=flow,
        )

        html, _ = service.render_with_fallback(
            GATHERING_TYPE, {}, popup_id=popup.id, sales_flow_id=flow.id, db_session=db
        )

        assert "Flow wording" not in html


class TestDegrading:
    def test_an_inactive_row_is_not_used(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_template(
            db,
            popup,
            template_type=GATHERING_TYPE,
            html="<p>Switched off</p>",
            is_active=False,
        )

        html, _ = service.render_with_fallback(
            GATHERING_TYPE, {}, popup_id=popup.id, db_session=db
        )

        assert "Switched off" not in html

    def test_a_broken_row_does_not_take_the_mail_down(
        self, db: Session, tenant_a: Tenants, service: EmailService
    ) -> None:
        """A customization an operator broke must cost them the wording, not
        the email."""
        popup = _make_popup(db, tenant_a)
        _make_template(
            db,
            popup,
            template_type=GATHERING_TYPE,
            html="<p>{% for %}</p>",
        )

        html, _ = service.render_with_fallback(
            GATHERING_TYPE, {}, popup_id=popup.id, db_session=db
        )

        assert html
