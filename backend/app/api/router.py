from fastapi import APIRouter

from app.api import (
    api_key,
    application,
    application_review,
    approval_strategy,
    attendee,
    auth,
    base_field_config,
    cart,
    checkout,
    coupon,
    dashboard,
    email_template,
    event,
    event_participant,
    event_settings,
    event_venue,
    form_field,
    form_section,
    group,
    human,
    payment,
    popup,
    popup_reviewer,
    product,
    tenant,
    ticketing_step,
    track,
    translation,
    upload,
    user,
)
from app.api.application.router import portal_router

api_router = APIRouter()

# Core resources
api_router.include_router(user.router)
api_router.include_router(auth.router)
api_router.include_router(tenant.router)
api_router.include_router(human.router)
api_router.include_router(api_key.router)
api_router.include_router(popup.router)

# Popup-related resources
api_router.include_router(product.router)
api_router.include_router(product.tier_router)
api_router.include_router(coupon.router)
api_router.include_router(group.router)
api_router.include_router(form_section.router)
api_router.include_router(form_field.router)
api_router.include_router(email_template.router)
api_router.include_router(base_field_config.router)
api_router.include_router(ticketing_step.router)

# Approval system resources (registered before application so static paths
# like /applications/pending-review are matched before /{application_id})
api_router.include_router(approval_strategy.router)
api_router.include_router(popup_reviewer.router)
api_router.include_router(application_review.router)

# Application flow resources
api_router.include_router(application.router)
api_router.include_router(portal_router)
api_router.include_router(attendee.router)
api_router.include_router(payment.router)
api_router.include_router(cart.router)

# Translations (i18n)
api_router.include_router(translation.router)

# Open-ticketing checkout (public, anonymous)
api_router.include_router(checkout.router)

# Utility resources
api_router.include_router(upload.router)

# Events module
api_router.include_router(event.router)
api_router.include_router(event_participant.router)
api_router.include_router(event_venue.router)
api_router.include_router(event_venue.utils_router)
api_router.include_router(event_venue.property_types_router)
api_router.include_router(event_settings.router)
api_router.include_router(track.router)

# Dashboard
api_router.include_router(dashboard.router)
