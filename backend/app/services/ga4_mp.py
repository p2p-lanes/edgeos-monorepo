"""Send confirmed ticket purchases to tenant GA4 web streams."""

import asyncio
import re
from dataclasses import dataclass, field
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
from loguru import logger

from app.services.meta_capi import _contents, _custom_data, _has_ticket_product
from app.utils.encryption import decrypt

GA4_MP_URL = "https://www.google-analytics.com/mp/collect"
GA4_MP_TIMEOUT_SECONDS = 5.0
_MEASUREMENT_ID_RE = re.compile(r"^G-[A-Z0-9]+$", re.IGNORECASE)
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_SESSION_ID_RE = re.compile(r"^\d{1,20}$")


@dataclass(frozen=True)
class PreparedGA4Purchase:
    measurement_id: str
    encrypted_api_secret: str = field(repr=False)
    payload: dict[str, Any] = field(repr=False)
    payment_id: str
    popup_id: str


def prepare_purchase_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> PreparedGA4Purchase | None:
    """Build one GA4 purchase using the same ticket eligibility as Meta CAPI."""
    measurement_id = str(getattr(tenant, "ga_measurement_id", "") or "").strip()
    encrypted_secret = getattr(tenant, "ga_mp_api_secret_encrypted", None)
    client_id = str(getattr(payment, "ga_client_id", "") or "").strip()
    if (
        not getattr(tenant, "ga_tracking_enabled", False)
        or not _MEASUREMENT_ID_RE.fullmatch(measurement_id)
        or not encrypted_secret
        or not _CLIENT_ID_RE.fullmatch(client_id)
    ):
        return None

    resolved_popup = popup or getattr(payment, "popup", None)
    if resolved_popup is None or not _has_ticket_product(payment):
        return None

    payment_id = str(getattr(payment, "id", "") or "")
    if not payment_id:
        return None
    purchase_data = _custom_data(payment, resolved_popup, include_order_id=True)
    params: dict[str, Any] = {
        "transaction_id": payment_id,
        "currency": purchase_data["currency"],
        "value": purchase_data["value"],
        "items": [
            {"item_id": item["id"], "quantity": item["quantity"], "price": 0}
            for item in _contents(payment)
        ],
        "popup_id": purchase_data["popup_id"],
        "popup_slug": purchase_data["popup_slug"],
        "popup_name": purchase_data["popup_name"],
        "engagement_time_msec": 1,
    }
    session_id = str(getattr(payment, "ga_session_id", "") or "").strip()
    if _SESSION_ID_RE.fullmatch(session_id):
        params["session_id"] = session_id

    return PreparedGA4Purchase(
        measurement_id=measurement_id,
        encrypted_api_secret=str(encrypted_secret),
        payload={
            "client_id": client_id,
            "events": [{"name": "purchase", "params": params}],
        },
        payment_id=payment_id,
        popup_id=str(getattr(resolved_popup, "id", "")),
    )


def _snapshots(tenant: Any, payment: Any, popup: Any | None) -> tuple[Any, Any, Any]:
    resolved_popup = popup or getattr(payment, "popup", None)
    tenant_snapshot = SimpleNamespace(
        ga_tracking_enabled=getattr(tenant, "ga_tracking_enabled", False),
        ga_measurement_id=getattr(tenant, "ga_measurement_id", None),
        ga_mp_api_secret_encrypted=getattr(tenant, "ga_mp_api_secret_encrypted", None),
    )
    payment_snapshot = SimpleNamespace(
        id=getattr(payment, "id", None),
        amount=getattr(payment, "amount", Decimal("0")),
        amount_charged=getattr(payment, "amount_charged", None),
        currency=getattr(payment, "currency", None),
        ga_client_id=getattr(payment, "ga_client_id", None),
        ga_session_id=getattr(payment, "ga_session_id", None),
        products_snapshot=[
            SimpleNamespace(
                product_id=getattr(item, "product_id", None),
                quantity=getattr(item, "quantity", 1),
                effective_unit_price=getattr(item, "effective_unit_price", None),
                product_price=getattr(item, "product_price", Decimal("0")),
                product_name=getattr(item, "product_name", ""),
                product_category=getattr(item, "product_category", ""),
            )
            for item in (getattr(payment, "products_snapshot", None) or [])
        ],
    )
    popup_snapshot = (
        SimpleNamespace(
            id=getattr(resolved_popup, "id", None),
            slug=getattr(resolved_popup, "slug", ""),
            name=getattr(resolved_popup, "name", ""),
            currency=getattr(resolved_popup, "currency", "USD"),
        )
        if resolved_popup is not None
        else None
    )
    return tenant_snapshot, payment_snapshot, popup_snapshot


def enqueue_purchase_event(
    background_tasks: Any, tenant: Any, payment: Any, popup: Any | None = None
) -> None:
    """Do not make checkout wait for GA4 or retain ORM objects after response."""
    try:
        snapshots = _snapshots(tenant, payment, popup)
        background_tasks.add_task(prepare_and_send_purchase_event, *snapshots)
    except Exception:
        logger.exception(
            "Failed to queue GA4 Purchase payment_id={}", getattr(payment, "id", "")
        )


def fire_and_forget_purchase_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> None:
    """Schedule delayed approvals without blocking payment settlement."""
    try:
        snapshots = _snapshots(tenant, payment, popup)
        asyncio.get_running_loop().create_task(
            prepare_and_send_purchase_event(*snapshots)
        )
    except Exception:
        logger.exception(
            "Failed to schedule GA4 Purchase payment_id={}", getattr(payment, "id", "")
        )


async def prepare_and_send_purchase_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> None:
    try:
        await send_prepared_purchase_event(
            prepare_purchase_event(tenant, payment, popup)
        )
    except Exception:
        logger.exception(
            "GA4 Purchase background task failed payment_id={}",
            getattr(payment, "id", ""),
        )


async def send_prepared_purchase_event(event: PreparedGA4Purchase | None) -> None:
    if event is None:
        return
    try:
        api_secret = decrypt(event.encrypted_api_secret)
        async with httpx.AsyncClient(timeout=GA4_MP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                GA4_MP_URL,
                params={
                    "measurement_id": event.measurement_id,
                    "api_secret": api_secret,
                },
                json=event.payload,
            )
        response.raise_for_status()
        # A 2xx means received, not that Google accepted the event for reporting.
        logger.info(
            "GA4 Purchase received payment_id={} popup_id={}",
            event.payment_id,
            event.popup_id,
        )
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "GA4 Purchase rejected payment_id={} popup_id={} status={}",
            event.payment_id,
            event.popup_id,
            exc.response.status_code,
        )
    except (httpx.RequestError, ValueError):
        # Request exceptions may contain the URL, whose query includes the secret.
        logger.warning(
            "GA4 Purchase request failed payment_id={} popup_id={}",
            event.payment_id,
            event.popup_id,
        )
