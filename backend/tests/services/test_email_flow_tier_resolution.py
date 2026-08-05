"""Email template three-tier resolution (sdd/sales-flows slice 10, task 10.2).

`EmailService.render_with_fallback` resolves flow -> popup -> tenant/file for
every popup-scope template type. Design: an inactive or missing flow-tier row
falls through to the popup tier exactly as it did before this slice — the
standing rule's G1/G5 fallback-compatibility guarantee (a flow with no
template override behaves byte-identically to today) is proven explicitly by
`test_flow_fallback_is_byte_identical_to_legacy_behavior`.
"""

import uuid

from sqlmodel import Session

from app.api.email_template.models import EmailTemplates
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowCreate
from app.api.tenant.models import Tenants
from app.services.email.service import EmailService

_TEMPLATE_TYPE = "application_received"


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Email Tier Popup {uuid.uuid4().hex[:6]}",
        slug=f"email-tier-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_flow(db: Session, tenant: Tenants, popup: Popups, *, slug: str) -> SalesFlows:
    return sales_flows_crud.create(
        db,
        SalesFlowCreate(popup_id=popup.id, slug=slug, name=slug),
        tenant_id=tenant.id,
    )


def _make_template(
    db: Session,
    tenant: Tenants,
    *,
    popup_id: uuid.UUID | None,
    sales_flow_id: uuid.UUID | None = None,
    html_content: str,
    subject: str | None = None,
    is_active: bool = True,
    template_type: str = _TEMPLATE_TYPE,
) -> EmailTemplates:
    template = EmailTemplates(
        tenant_id=tenant.id,
        popup_id=popup_id,
        sales_flow_id=sales_flow_id,
        template_type=template_type,
        html_content=html_content,
        subject=subject,
        is_active=is_active,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def test_flow_tier_wins_over_popup_tier(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-a")
    _make_template(db, tenant_a, popup_id=popup.id, html_content="<p>Popup version</p>")
    _make_template(
        db,
        tenant_a,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        html_content="<p>Flow version</p>",
    )

    html, _ = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    assert "Flow version" in html
    assert "Popup version" not in html


def test_inactive_flow_row_falls_through_to_popup_tier(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-b")
    _make_template(
        db, tenant_a, popup_id=popup.id, html_content="<p>Popup active version</p>"
    )
    _make_template(
        db,
        tenant_a,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        html_content="<p>Flow inactive version</p>",
        is_active=False,
    )

    html, _ = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    assert "Popup active version" in html
    assert "Flow inactive version" not in html


def test_flow_with_no_row_falls_through_to_popup_tier(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-c")
    _make_template(
        db, tenant_a, popup_id=popup.id, html_content="<p>Only popup row exists</p>"
    )

    html, _ = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    assert "Only popup row exists" in html


def test_flow_fallback_is_byte_identical_to_legacy_behavior(
    db: Session, tenant_a: Tenants
) -> None:
    """G1/G5 fallback-compatibility proof: a flow with no template override
    of its own must render EXACTLY what the pre-slice-10 (no `sales_flow_id`
    argument at all) resolution produced — not just "similar", identical.
    """
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-d")
    _make_template(
        db,
        tenant_a,
        popup_id=popup.id,
        html_content="<p>Legacy popup template {{ popup_name }}</p>",
        subject="Legacy subject",
    )

    legacy_html, legacy_subject = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={"popup_name": popup.name},
        popup_id=popup.id,
        db_session=db,
    )
    flow_html, flow_subject = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={"popup_name": popup.name},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    assert flow_html == legacy_html
    assert flow_subject == legacy_subject


def test_flow_render_error_falls_through_to_popup_tier(
    db: Session, tenant_a: Tenants
) -> None:
    """Slice 14 backlog: a flow-tier template that fails to render (invalid
    Jinja syntax here) falls through to the popup tier instead of raising
    and blocking the send."""
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-f")
    _make_template(
        db, tenant_a, popup_id=popup.id, html_content="<p>Popup safe version</p>"
    )
    _make_template(
        db,
        tenant_a,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        html_content="<p>Broken {% if %}</p>",
    )

    html, _ = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    assert "Popup safe version" in html


def test_popup_render_error_falls_through_to_file_default(
    db: Session, tenant_a: Tenants
) -> None:
    """Same fallback, one tier down: a broken popup-tier template (no flow
    override present) falls through to the file-based default."""
    popup = _make_popup(db, tenant_a)
    _make_template(
        db, tenant_a, popup_id=popup.id, html_content="<p>Broken {% if %}</p>"
    )

    html, subject = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={"popup_name": popup.name},
        popup_id=popup.id,
        db_session=db,
    )

    assert subject is None
    assert html


def test_no_override_at_any_tier_falls_through_to_file_default(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, tenant_a, popup, slug="flow-e")

    html, subject = EmailService().render_with_fallback(
        template_type=_TEMPLATE_TYPE,
        context={"popup_name": popup.name},
        popup_id=popup.id,
        sales_flow_id=flow.id,
        db_session=db,
    )

    # File-based default: no custom subject override, and the file template
    # renders (non-empty HTML), proving the flow tier never blocks the
    # final fallback when neither tier has a custom row.
    assert subject is None
    assert html
