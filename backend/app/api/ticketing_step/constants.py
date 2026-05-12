import uuid

from sqlmodel import Session

DEFAULT_TICKETING_STEPS = [
    {
        "step_type": "tickets",
        "title": "Tickets",
        "description": "Choose passes for yourself and family members",
        "watermark": "Passes",
        "template": "ticket-select",
        "template_config": {
            "sections": [
                {"key": "full", "label": "Full Passes", "order": 0, "product_ids": []},
                {"key": "month", "label": "Month Pass", "order": 1, "product_ids": []},
                {
                    "key": "week",
                    "label": "Weekly Passes",
                    "order": 2,
                    "product_ids": [],
                },
                {"key": "day", "label": "Day Passes", "order": 3, "product_ids": []},
            ]
        },
        "order": 0,
        "is_enabled": True,
        "protected": False,
        "product_category": "ticket",
    },
    {
        "step_type": "housing",
        "title": "Housing",
        "description": "Optional: Book accommodation for your stay",
        "watermark": "Housing",
        "template": "housing-date",
        "order": 1,
        "is_enabled": True,
        "protected": False,
        "product_category": "housing",
    },
    {
        "step_type": "merch",
        "title": "Merchandise",
        "description": "Optional: Pick up exclusive merch at the event",
        "watermark": "Merch",
        "template": "merch-image",
        "order": 2,
        "is_enabled": True,
        "protected": False,
        "product_category": "merch",
    },
    {
        "step_type": "patron",
        "title": "Patron",
        "description": "Optional: Support the community with a contribution",
        "watermark": "Patron",
        "template": "patron-preset",
        "template_config": {
            "presets": [2500, 5000, 7500],
            "allow_custom": True,
            "minimum": 1000,
        },
        "order": 3,
        "is_enabled": True,
        "protected": False,
        "product_category": "patreon",
    },
    # buyer step is direct-sale only — see seed_ticketing_steps_for_popup below
    # for the gate. We keep it in the canonical list so reorder operations
    # can move it around when the popup is direct-sale.
    {
        "step_type": "buyer",
        "title": "Your information",
        "description": "Complete your information before payment.",
        "watermark": "Your info",
        "template": "buyer-form",
        "template_config": None,
        "order": 4,
        "is_enabled": True,
        "protected": True,
        "_direct_sale_only": True,
    },
    {
        "step_type": "confirm",
        "title": "Review & Confirm",
        "description": "Review your order before payment",
        "watermark": "Confirm",
        "order": 5,
        "is_enabled": True,
        "protected": True,
        "template_config": {
            "insurance": {
                "card_title": "Insurance",
                "card_subtitle": "Change of plans coverage",
                "toggle_label": "Add insurance",
                "benefits": [
                    "Full refund up to 14 days before the event",
                    "50% refund up to 7 days before",
                    "Free date change at no extra cost",
                ],
            }
        },
    },
]


def seed_ticketing_steps_for_popup(
    db: Session,
    popup_id: uuid.UUID,
    tenant_id: uuid.UUID,
    sale_type: str | None = None,
) -> None:
    """Seed the default ticketing-step set for a popup.

    Steps flagged with ``_direct_sale_only`` (e.g. the buyer step) only get
    inserted when ``sale_type='direct'``. Application popups don't need the
    open-ticketing buyer step because the buyer info is collected via the
    application form earlier in the funnel.
    """
    from app.api.ticketing_step.models import TicketingSteps

    for step_def in DEFAULT_TICKETING_STEPS:
        if step_def.get("_direct_sale_only") and sale_type != "direct":
            continue
        step = TicketingSteps(
            tenant_id=tenant_id,
            popup_id=popup_id,
            step_type=step_def["step_type"],
            title=step_def["title"],
            description=step_def.get("description"),
            watermark=step_def.get("watermark"),
            template=step_def.get("template"),
            template_config=step_def.get("template_config"),
            order=step_def["order"],
            is_enabled=step_def["is_enabled"],
            protected=step_def["protected"],
            product_category=step_def.get("product_category"),
        )
        db.add(step)

    db.commit()
