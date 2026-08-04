"""CRUD aggregator for the open-ticketing checkout bootstrap endpoint (CAP-A)."""

import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlmodel import Session, select

if TYPE_CHECKING:
    from app.api.human.schemas import HumanPublic

from app.api.attendee_category.crud import attendee_categories_crud
from app.api.attendee_category.schemas import AttendeeCategoryPublic
from app.api.checkout.schemas import (
    CheckoutBuyerField,
    CheckoutBuyerSection,
    CheckoutRuntimeProduct,
    CheckoutRuntimeResponse,
    CheckoutShareMeta,
)
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.crud import form_sections_crud
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupPublic, PopupStatus
from app.api.product.models import Products
from app.api.sales_flow.eligibility import assert_upsale_eligible
from app.api.sales_flow.resolver import resolve_flow
from app.api.sales_flow.schemas import SalesFlowType
from app.api.shared.enums import SaleType
from app.api.ticketing_step.crud import ticketing_steps_crud
from app.api.ticketing_step.models import TicketingSteps
from app.api.ticketing_step.schemas import TicketingStepPublic
from app.api.translation.service import (
    TRANSLATABLE_FIELDS,
    apply_ticketing_step_overlay,
    apply_translation_overlay,
    get_translations_bulk,
    get_translations_for_entity,
)


def resolve_active_direct_popup_slug(db: Session, tenant_id: uuid.UUID) -> str | None:
    """Return the slug of the earliest active direct-sale popup for a tenant.

    Resolution rule (ADR, OI-4, OI-5):
      WHERE status='active' AND sale_type='direct' AND tenant_id=:tid
      ORDER BY start_date ASC NULLS LAST, id ASC
      LIMIT 1

    Returns None when no matching popup exists — callers handle None gracefully
    (signals the Coming Soon path in the portal). Never raises.
    """
    popup = db.exec(
        select(Popups)
        .where(
            Popups.tenant_id == tenant_id,
            Popups.status == PopupStatus.active,
            Popups.sale_type == SaleType.direct,
        )
        .order_by(
            Popups.start_date.asc().nulls_last(),  # type: ignore[attr-defined]
            Popups.id.asc(),  # type: ignore[attr-defined]
        )
        .limit(1)
    ).first()

    return popup.slug if popup is not None else None


def get_open_ticketing_popup(
    session: Session, slug: str, tenant_id: uuid.UUID
) -> Popups:
    """Resolve an active direct-sale popup by slug and tenant for open ticketing.

    Raises:
        404 — popup not found by slug + tenant_id
        403 — popup is not sale_type=direct OR is not active
    """
    popup = session.exec(
        select(Popups).where(Popups.slug == slug, Popups.tenant_id == tenant_id)
    ).first()

    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    if popup.sale_type != SaleType.direct.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is only available for direct-sale popups",
        )

    if popup.status != PopupStatus.active.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Popup is not active",
        )

    return popup


def _get_popup_by_slug_or_404(
    session: Session, slug: str, tenant_id: uuid.UUID
) -> Popups:
    """404-only popup lookup for the checkout runtime.

    sdd/sales-flows slice 9: the runtime's type/status gating moved to the
    flow resolver (`resolve_flow`, keyed off the RESOLVED flow, not the raw
    popup columns) — this helper only proves the popup exists, matching
    `get_open_ticketing_popup`'s first gate without duplicating its
    popup.sale_type/popup.status checks, which every OTHER checkout
    endpoint (purchase, cart, share, pending/release) still uses unchanged.
    """
    popup = session.exec(
        select(Popups).where(Popups.slug == slug, Popups.tenant_id == tenant_id)
    ).first()
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    return popup


def runtime_for_slug(
    session: Session,
    slug: str,
    tenant_id: uuid.UUID,
    flow_slug: str | None = None,
    lang: str | None = None,
    current_human: "HumanPublic | None" = None,
) -> CheckoutRuntimeResponse:
    """Load the public runtime data for an open-ticketing checkout page.

    sdd/sales-flows slice 9 (task 9.2/9.8): resolves the sales flow named by
    ``flow_slug`` (or the popup's default flow when omitted) through
    `resolve_flow` — gate order, status codes, and the direct/upsale type
    restriction all live there now (design's Flow-Resolution Contract).
    Products, buyer-form sections/fields, and ticketing steps are then all
    resolved through THAT SAME flow, closing two disclosed slice-8 gaps:
    - risk-001: fields come from the tier-filtered `find_for_flow` list,
      grouped by section afterward — never the unfiltered
      `FormSections.form_fields` ORM relationship (which ignored
      `sales_flow_id` and could leak a different flow's field that happens
      to share a section id).
    - res-001: buyer_form/form_schema now get the same translation overlay
      treatment as `form_field/router.py`'s portal schema endpoint (they
      previously got none at all on this path).

    When ``lang`` is provided, popup, product, and ticketing-step text is
    overlaid with the matching translations. The overlay is default-agnostic:
    if the requested language equals the popup default (no rows exist), the
    untranslated source is returned unchanged.

    sdd/sales-flows slice 13 (task 13.1/13.2): an upsale-type flow
    additionally requires ``current_human`` to be a portal-authenticated
    human with >=1 APPROVED payment in this popup (design D8, G0 #2/#3) —
    see `assert_upsale_eligible`. Direct-type flows are unaffected; this
    endpoint remains fully anonymous for them.
    """
    popup = _get_popup_by_slug_or_404(session, slug, tenant_id)
    flow = resolve_flow(
        session,
        popup,
        flow_slug,
        require_types={SalesFlowType.direct, SalesFlowType.upsale},
    )
    assert_upsale_eligible(session, flow, popup.id, tenant_id, current_human)

    # Load active products. Flow-scoped product filtering (flow_products,
    # design D3) is wired in slice 12 (restriction enforcement) — every
    # flow of a popup sees the full active catalog until then.
    products = list(
        session.exec(
            select(Products).where(
                Products.popup_id == popup.id,
                Products.is_active == True,  # noqa: E712
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
        ).all()
    )

    sections, _ = form_sections_crud.find_for_flow(
        session, popup.id, flow.id, limit=None
    )
    fields, _ = form_fields_crud.find_for_flow(
        session, popup.id, flow.id, skip=0, limit=1000
    )
    fields_by_section: dict[uuid.UUID | None, list[FormFields]] = {}
    for f in fields:
        fields_by_section.setdefault(f.section_id, []).append(f)

    ticketing_steps = ticketing_steps_crud.find_portal_for_flow(
        session, popup_id=popup.id, flow_id=flow.id
    )

    attendee_categories = attendee_categories_crud.list_by_popup(session, popup.id)

    # Translation overlays. Every branch is a no-op when lang is None or when no
    # rows match the requested language, so the untranslated source is returned.
    popup_data = PopupPublic.model_validate(popup).model_dump()
    product_translations: dict[uuid.UUID, dict] = {}
    step_translations: dict[uuid.UUID, dict] = {}
    field_translations: dict[uuid.UUID, dict] = {}
    section_translations: dict[uuid.UUID, dict] = {}
    if lang:
        popup_data = apply_translation_overlay(
            popup_data,
            get_translations_for_entity(session, "popup", popup.id, lang),
            TRANSLATABLE_FIELDS["popup"],
        )
        product_translations = get_translations_bulk(
            session, "product", [p.id for p in products], lang
        )
        step_translations = get_translations_bulk(
            session, "ticketing_step", [s.id for s in ticketing_steps], lang
        )
        field_translations = get_translations_bulk(
            session, "form_field", [f.id for f in fields], lang
        )
        section_translations = get_translations_bulk(
            session, "form_section", [s.id for s in sections], lang
        )

    def _product(p: Products) -> CheckoutRuntimeProduct:
        data = {**p.model_dump(), "currency": popup.currency}
        data = apply_translation_overlay(
            data, product_translations.get(p.id), TRANSLATABLE_FIELDS["product"]
        )
        return CheckoutRuntimeProduct.model_validate(data)

    def _step(step: TicketingSteps) -> TicketingStepPublic:
        data = TicketingStepPublic.model_validate(step).model_dump()
        data = apply_ticketing_step_overlay(data, step_translations.get(step.id))
        return TicketingStepPublic.model_validate(data)

    def _field(f: FormFields) -> CheckoutBuyerField:
        data = CheckoutBuyerField.model_validate(f).model_dump()
        data = apply_translation_overlay(
            data, field_translations.get(f.id), TRANSLATABLE_FIELDS["form_field"]
        )
        return CheckoutBuyerField.model_validate(data)

    def _section(sec: FormSections) -> CheckoutBuyerSection:
        data = {
            "id": sec.id,
            "label": sec.label,
            "description": sec.description,
            "order": sec.order,
            "kind": sec.kind,
        }
        data = apply_translation_overlay(
            data, section_translations.get(sec.id), TRANSLATABLE_FIELDS["form_section"]
        )
        section_fields = sorted(
            fields_by_section.get(sec.id, []), key=lambda field: field.position
        )
        return CheckoutBuyerSection(
            **data, form_fields=[_field(f) for f in section_fields]
        )

    form_schema = form_fields_crud.build_schema_for_flow(session, popup.id, flow.id)
    if lang:
        for f in fields:
            if f.id in field_translations:
                t_data = field_translations[f.id]
                entry = form_schema["custom_fields"].get(f.name)
                if entry:
                    for key in TRANSLATABLE_FIELDS["form_field"]:
                        if key in t_data:
                            entry[key] = t_data[key]
        for section_dict in form_schema["sections"]:
            sid = uuid.UUID(section_dict["id"])
            if sid in section_translations:
                t_data = section_translations[sid]
                for key in TRANSLATABLE_FIELDS["form_section"]:
                    if key in t_data:
                        section_dict[key] = t_data[key]

    return CheckoutRuntimeResponse(
        popup=PopupPublic.model_validate(popup_data),
        products=[_product(p) for p in products],
        buyer_form=[
            # Hidden sections (and their fields) are never surfaced to the
            # anonymous checkout, mirroring build_schema_for_flow.
            _section(sec)
            for sec in sections
            if not sec.hidden
        ],
        ticketing_steps=[_step(step) for step in ticketing_steps],
        attendee_categories=[
            AttendeeCategoryPublic.model_validate(c) for c in attendee_categories
        ],
        form_schema=form_schema,
    )


def share_meta_for_slug(
    session: Session, slug: str, tenant_id: uuid.UUID
) -> CheckoutShareMeta:
    """Load the minimal popup projection for social/OpenGraph share previews."""
    popup = get_open_ticketing_popup(session, slug, tenant_id)
    return CheckoutShareMeta(
        id=popup.id,
        name=popup.name,
        tagline=popup.tagline,
        location=popup.location,
        image_url=popup.image_url,
    )
