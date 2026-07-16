"""CRUD aggregator for the open-ticketing checkout bootstrap endpoint (CAP-A)."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

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
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupPublic, PopupStatus
from app.api.product.models import Products
from app.api.shared.enums import SaleType
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


def runtime_for_slug(
    session: Session, slug: str, tenant_id: uuid.UUID, lang: str | None = None
) -> CheckoutRuntimeResponse:
    """Load the public runtime data for an open-ticketing checkout page.

    When ``lang`` is provided, popup, product, and ticketing-step text is
    overlaid with the matching translations. The overlay is default-agnostic:
    if the requested language equals the popup default (no rows exist), the
    untranslated source is returned unchanged.
    """
    popup = get_open_ticketing_popup(session, slug, tenant_id)

    # Load active products
    products = list(
        session.exec(
            select(Products).where(
                Products.popup_id == popup.id,
                Products.is_active == True,  # noqa: E712
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
        ).all()
    )

    # Load form_sections with their form_fields, ordered by section.order then field.position
    sections = list(
        session.exec(
            select(FormSections)
            .where(FormSections.popup_id == popup.id)
            .order_by(FormSections.order)  # type: ignore[arg-type]
            .options(selectinload(FormSections.form_fields))  # ty: ignore[invalid-argument-type]
        ).all()
    )

    ticketing_steps = list(
        session.exec(
            select(TicketingSteps)
            .where(
                TicketingSteps.popup_id == popup.id,
                TicketingSteps.is_enabled == True,  # noqa: E712
            )
            .order_by(TicketingSteps.order)  # type: ignore[arg-type]
        ).all()
    )

    attendee_categories = attendee_categories_crud.list_by_popup(session, popup.id)

    # Translation overlays. Every branch is a no-op when lang is None or when no
    # rows match the requested language, so the untranslated source is returned.
    popup_data = PopupPublic.model_validate(popup).model_dump()
    product_translations: dict[uuid.UUID, dict] = {}
    step_translations: dict[uuid.UUID, dict] = {}
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

    return CheckoutRuntimeResponse(
        popup=PopupPublic.model_validate(popup_data),
        products=[_product(p) for p in products],
        buyer_form=[
            CheckoutBuyerSection(
                id=sec.id,
                label=sec.label,
                description=sec.description,
                order=sec.order,
                kind=sec.kind,
                form_fields=sorted(
                    [CheckoutBuyerField.model_validate(f) for f in sec.form_fields],
                    key=lambda f: f.position,
                ),
            )
            for sec in sections
        ],
        ticketing_steps=[_step(step) for step in ticketing_steps],
        attendee_categories=[
            AttendeeCategoryPublic.model_validate(c) for c in attendee_categories
        ],
        form_schema=form_fields_crud.build_schema_for_popup(session, popup.id),
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
