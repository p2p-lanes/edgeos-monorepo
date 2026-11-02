"""Best-effort server-side Purchase notifications after committed approval."""

from typing import Any

from loguru import logger


def schedule_purchase_events(payment: Any) -> None:
    """Keep provider failures independent and outside the approval transaction."""
    from app.services.ga4_mp import fire_and_forget_purchase_event as send_ga4
    from app.services.meta_capi import fire_and_forget_purchase_event as send_meta

    for provider, send in (("Meta CAPI", send_meta), ("GA4", send_ga4)):
        try:
            send(tenant=payment.tenant, payment=payment, popup=payment.popup)
        except Exception:
            logger.exception(
                "Failed to queue {} Purchase event payment_id={}", provider, payment.id
            )
