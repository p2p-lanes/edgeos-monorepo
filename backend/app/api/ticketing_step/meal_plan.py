"""Shared meal-plan choice validation.

Single source of truth for resolving a meal-plan product's weekly config from
the popup's ``meal-plan-select`` TicketingStep and validating per-day menu
choices against it. Used by the post-purchase edit endpoint
(``PATCH .../tickets/{ticket_id}/meal-plan``); a future purchase-time validator
could reuse the same helpers.

Both functions are pure (no commit, no side effects) and reuse the typed
schemas from ``ticketing_step/schemas.py``.
"""

import uuid
from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.ticketing_step.models import TicketingSteps
from app.api.ticketing_step.schemas import (
    MealPlanChefChoiceOption,
    MealPlanSection,
    MealPlanSectionProduct,
)

# The chef's choice key is hard-coded to "chef" in v0 (see MealPlanChefChoiceOption).
CHEF_CHOICE_KEY = "chef"

_ONE_DAY = timedelta(days=1)


def resolve_meal_plan_product_config(
    session: Session,
    popup_id: uuid.UUID,
    product_id: uuid.UUID,
) -> tuple[MealPlanSectionProduct, MealPlanChefChoiceOption | None] | None:
    """Resolve the weekly config for a product inside the popup's meal-plan step.

    Finds the enabled ``meal-plan-select`` TicketingStep for the popup, walks
    its ``sections[].products[]`` and returns the entry whose ``product_id``
    matches, paired with the step-level chef_choice_option (or None when the
    step does not define one).

    Returns None when the popup has no enabled meal-plan step, or the product is
    not a meal-plan week in that step (the caller maps None to a 422).
    """
    step = session.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == popup_id,
            TicketingSteps.template == "meal-plan-select",
            TicketingSteps.is_enabled == True,  # noqa: E712
        )
    ).first()
    if step is None or not step.template_config:
        return None

    raw_sections = step.template_config.get("sections")
    if not isinstance(raw_sections, list):
        return None

    chef_raw = step.template_config.get("chef_choice_option")
    chef = (
        MealPlanChefChoiceOption.model_validate(chef_raw)
        if chef_raw is not None
        else None
    )

    for raw_section in raw_sections:
        section = MealPlanSection.model_validate(raw_section)
        for section_product in section.products:
            if section_product.product_id == product_id:
                return section_product, chef

    return None


def _covered_weekdays(section_product: MealPlanSectionProduct) -> set[str]:
    """Return the set of ISO weekday dates (Mon–Fri) the product covers.

    Mirrors the portal's ``weekdayDates`` helper: every Mon–Fri date within the
    inclusive ``[coverage_start, coverage_end]`` range. Weekends are excluded.
    """
    out: set[str] = set()
    current: date = section_product.coverage_start
    end: date = section_product.coverage_end
    while current <= end:
        # Monday=0 .. Sunday=6 → keep Mon–Fri.
        if current.weekday() <= 4:
            out.add(current.isoformat())
        current = current + _ONE_DAY
    return out


def validate_daily_choices(
    daily_choices: dict[str, str],
    section_product: MealPlanSectionProduct,
    chef: MealPlanChefChoiceOption | None,
) -> None:
    """Validate per-day menu choices against the product's weekly config.

    Raises ``HTTPException(422)`` when:
      - a date is not a covered weekday (outside coverage range or a weekend), or
      - a value is neither a menu_option key nor the chef's choice key.

    Accepts an empty dict (no days planned yet is allowed).
    """
    covered = _covered_weekdays(section_product)
    valid_keys = {o.key for o in section_product.menu_options}
    chef_key = chef.key if chef is not None else CHEF_CHOICE_KEY
    valid_keys.add(chef_key)

    for raw_date, value in daily_choices.items():
        try:
            parsed = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "invalid_meal_plan_choice",
                    "message": f"'{raw_date}' is not a valid ISO date (YYYY-MM-DD).",
                },
            )
        if parsed.isoformat() not in covered:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "invalid_meal_plan_choice",
                    "message": (
                        f"{raw_date} is not a covered weekday for this meal-plan week."
                    ),
                },
            )
        if value not in valid_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "invalid_meal_plan_choice",
                    "message": f"'{value}' is not a valid menu option for {raw_date}.",
                },
            )
