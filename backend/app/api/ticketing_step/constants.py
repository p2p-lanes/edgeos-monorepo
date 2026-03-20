import uuid

from sqlmodel import Session

DEFAULT_TICKETING_STEPS = [
    {
        "step_type": "tickets",
        "title": "Tickets",
        "order": 0,
        "is_enabled": True,
        "protected": False,
        "product_category": "ticket",
    },
    {
        "step_type": "housing",
        "title": "Housing",
        "order": 1,
        "is_enabled": True,
        "protected": False,
        "product_category": "housing",
    },
    {
        "step_type": "merch",
        "title": "Merchandise",
        "order": 2,
        "is_enabled": True,
        "protected": False,
        "product_category": "merch",
    },
    {
        "step_type": "patron",
        "title": "Patron",
        "order": 3,
        "is_enabled": True,
        "protected": False,
        "product_category": "patreon",
    },
    {
        "step_type": "insurance_checkout",
        "title": "Insurance",
        "order": 4,
        "is_enabled": False,
        "protected": False,
    },
    {
        "step_type": "confirm",
        "title": "Review & Confirm",
        "order": 5,
        "is_enabled": True,
        "protected": True,
    },
]


def seed_ticketing_steps_for_popup(
    db: Session,
    popup_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> None:
    from app.api.ticketing_step.models import TicketingSteps

    for step_def in DEFAULT_TICKETING_STEPS:
        step = TicketingSteps(
            tenant_id=tenant_id,
            popup_id=popup_id,
            step_type=step_def["step_type"],
            title=step_def["title"],
            order=step_def["order"],
            is_enabled=step_def["is_enabled"],
            protected=step_def["protected"],
            product_category=step_def.get("product_category"),
        )
        db.add(step)

    db.commit()
