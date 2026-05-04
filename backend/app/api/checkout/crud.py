"""CRUD aggregator for the open-ticketing checkout bootstrap endpoint (CAP-A)."""

from fastapi import HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.checkout.schemas import (
    CheckoutBuyerField,
    CheckoutBuyerSection,
    CheckoutRuntimeProduct,
    CheckoutRuntimeResponse,
)
from app.api.form_field.models import FormFields
from app.api.form_field.crud import form_fields_crud
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupPublic, PopupStatus
from app.api.product.crud import enrich_product_with_tier
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.ticketing_step.models import TicketingSteps
from app.api.ticketing_step.schemas import TicketingStepPublic


def get_open_ticketing_popup(session: Session, slug: str) -> Popups:
    """Resolve an active direct-sale popup by slug for open ticketing.

    Raises:
        404 — popup not found by slug
        403 — popup is not sale_type=direct OR is not active
    """
    popup = session.exec(
        select(Popups).where(Popups.slug == slug)
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


def runtime_for_slug(session: Session, slug: str) -> CheckoutRuntimeResponse:
    """Load the public runtime data for an open-ticketing checkout page."""
    popup = get_open_ticketing_popup(session, slug)

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

    return CheckoutRuntimeResponse(
        popup=PopupPublic.model_validate(popup),
        products=[
            CheckoutRuntimeProduct.model_validate(
                {
                    **CheckoutRuntimeProduct.model_validate(p).model_dump(),
                    **(
                        enrich_product_with_tier(session, p)
                        if popup.tier_progression_enabled
                        else {"tier_group": None, "phase": None}
                    ),
                }
            )
            for p in products
        ],
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
        ticketing_steps=[
            TicketingStepPublic.model_validate(step) for step in ticketing_steps
        ],
        form_schema=form_fields_crud.build_schema_for_popup(session, popup.id),
    )
