import asyncio
import hashlib
import re
import time
from dataclasses import dataclass
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
from loguru import logger

from app.utils.encryption import decrypt

META_GRAPH_API_VERSION = "v21.0"
META_CAPI_TIMEOUT_SECONDS = 5.0
_META_PIXEL_ID_RE = re.compile(r"^[0-9]{1,64}$")


@dataclass(frozen=True)
class PreparedMetaCapiPurchase:
    pixel_id: str
    encrypted_access_token: str
    payload: dict[str, Any]
    event_id: str
    payment_id: str
    popup_id: str
    event_name: str = "Purchase"


PreparedMetaCapiEvent = PreparedMetaCapiPurchase


def prepare_purchase_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> PreparedMetaCapiPurchase | None:
    """Prepare a Meta CAPI Purchase event from tenant-level tracking config."""
    encrypted_access_token = getattr(tenant, "meta_capi_access_token_encrypted", None)
    pixel_id = _normalize_pixel_id(getattr(tenant, "meta_pixel_id", None))
    if (
        not getattr(tenant, "meta_tracking_enabled", False)
        or not pixel_id
        or not encrypted_access_token
    ):
        return None

    resolved_popup = popup or getattr(payment, "popup", None)
    if resolved_popup is None:
        logger.warning(
            "Skipping Meta CAPI Purchase: popup missing event_id={} payment_id={}",
            _purchase_event_id(payment),
            str(getattr(payment, "id", "")),
        )
        return None

    event_id = _purchase_event_id(payment)
    payload = {
        "data": [
            {
                "event_name": "Purchase",
                "event_time": int(time.time()),
                "event_id": event_id,
                "action_source": "website",
                "custom_data": _custom_data(
                    payment,
                    resolved_popup,
                    include_order_id=True,
                ),
                "user_data": _user_data(payment),
            }
        ]
    }
    return PreparedMetaCapiPurchase(
        pixel_id=pixel_id,
        encrypted_access_token=str(encrypted_access_token),
        payload=payload,
        event_id=event_id,
        payment_id=str(getattr(payment, "id", "")),
        popup_id=str(getattr(resolved_popup, "id", "")),
    )


def prepare_initiate_checkout_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> PreparedMetaCapiEvent | None:
    """Prepare a Meta CAPI InitiateCheckout event from a pending payment."""
    encrypted_access_token = getattr(tenant, "meta_capi_access_token_encrypted", None)
    pixel_id = _normalize_pixel_id(getattr(tenant, "meta_pixel_id", None))
    if (
        not getattr(tenant, "meta_tracking_enabled", False)
        or not pixel_id
        or not encrypted_access_token
    ):
        return None

    resolved_popup = popup or getattr(payment, "popup", None)
    if resolved_popup is None:
        logger.warning(
            "Skipping Meta CAPI InitiateCheckout: popup missing event_id={} payment_id={}",
            _initiate_checkout_event_id(payment),
            str(getattr(payment, "id", "")),
        )
        return None

    event_id = _initiate_checkout_event_id(payment)
    payload = {
        "data": [
            {
                "event_name": "InitiateCheckout",
                "event_time": int(time.time()),
                "event_id": event_id,
                "action_source": "website",
                "custom_data": _custom_data(
                    payment,
                    resolved_popup,
                    include_order_id=False,
                ),
                "user_data": _user_data(payment),
            }
        ]
    }
    return PreparedMetaCapiEvent(
        pixel_id=pixel_id,
        encrypted_access_token=str(encrypted_access_token),
        payload=payload,
        event_id=event_id,
        payment_id=str(getattr(payment, "id", "")),
        popup_id=str(getattr(resolved_popup, "id", "")),
        event_name="InitiateCheckout",
    )


def enqueue_purchase_event(
    background_tasks: Any,
    tenant: Any,
    payment: Any,
    popup: Any | None = None,
) -> None:
    """Queue Meta CAPI preparation and send without letting it affect checkout."""
    try:
        tenant_snapshot = _tenant_snapshot(tenant)
        payment_snapshot = _payment_snapshot(payment)
        popup_snapshot = _popup_snapshot(popup) if popup is not None else None
    except Exception:
        logger.exception(
            "Failed to queue Meta CAPI Purchase event payment_id={}",
            _safe_object_id(payment),
        )
        return

    background_tasks.add_task(
        prepare_and_send_purchase_event,
        tenant_snapshot,
        payment_snapshot,
        popup_snapshot,
    )


def enqueue_initiate_checkout_event(
    background_tasks: Any,
    tenant: Any,
    payment: Any,
    popup: Any | None = None,
) -> None:
    """Queue Meta CAPI InitiateCheckout without affecting checkout."""
    try:
        tenant_snapshot = _tenant_snapshot(tenant)
        payment_snapshot = _payment_snapshot(payment)
        popup_snapshot = _popup_snapshot(popup) if popup is not None else None
    except Exception:
        logger.exception(
            "Failed to queue Meta CAPI InitiateCheckout event payment_id={}",
            _safe_object_id(payment),
        )
        return

    background_tasks.add_task(
        prepare_and_send_initiate_checkout_event,
        tenant_snapshot,
        payment_snapshot,
        popup_snapshot,
    )


def fire_and_forget_purchase_event(
    tenant: Any,
    payment: Any,
    popup: Any | None = None,
) -> None:
    """Schedule a Purchase event from synchronous/async flows without blocking."""
    try:
        tenant_snapshot = _tenant_snapshot(tenant)
        payment_snapshot = _payment_snapshot(payment)
        popup_snapshot = _popup_snapshot(popup) if popup is not None else None
    except Exception:
        logger.exception(
            "Failed to schedule Meta CAPI Purchase event payment_id={}",
            _safe_object_id(payment),
        )
        return

    try:
        asyncio.create_task(
            prepare_and_send_purchase_event(
                tenant_snapshot,
                payment_snapshot,
                popup_snapshot,
            )
        )
    except RuntimeError:
        logger.exception(
            "Failed to start Meta CAPI Purchase task payment_id={}",
            _safe_object_id(payment),
        )


async def prepare_and_send_purchase_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> None:
    """Prepare and send a Purchase event in the background, failure-safe."""
    try:
        event = prepare_purchase_event(tenant=tenant, payment=payment, popup=popup)
        await send_prepared_purchase_event(event)
    except Exception:
        logger.exception(
            "Meta CAPI Purchase background task failed payment_id={}",
            _safe_object_id(payment),
        )


async def prepare_and_send_initiate_checkout_event(
    tenant: Any, payment: Any, popup: Any | None = None
) -> None:
    """Prepare and send an InitiateCheckout event in the background."""
    try:
        event = prepare_initiate_checkout_event(
            tenant=tenant,
            payment=payment,
            popup=popup,
        )
        await send_prepared_purchase_event(event)
    except Exception:
        logger.exception(
            "Meta CAPI InitiateCheckout background task failed payment_id={}",
            _safe_object_id(payment),
        )


async def send_prepared_purchase_event(event: PreparedMetaCapiEvent | None) -> None:
    """Send a prepared event to Meta without blocking checkout success."""
    if event is None:
        return

    event_name = event.event_name

    try:
        access_token = decrypt(event.encrypted_access_token)
    except Exception:
        logger.exception(
            "Failed to decrypt Meta CAPI token event_name={} event_id={} payment_id={} popup_id={}",
            event_name,
            event.event_id,
            event.payment_id,
            event.popup_id,
        )
        return

    url = f"https://graph.facebook.com/{META_GRAPH_API_VERSION}/{event.pixel_id}/events"
    try:
        async with httpx.AsyncClient(timeout=META_CAPI_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                json={**event.payload, "access_token": access_token},
            )
        trace_id = response.headers.get("x-fb-trace-id")
        response.raise_for_status()
        logger.info(
            "Meta CAPI {} sent event_id={} payment_id={} popup_id={} meta_trace_id={}",
            event_name,
            event.event_id,
            event.payment_id,
            event.popup_id,
            trace_id or "-",
        )
    except httpx.HTTPStatusError as exc:
        trace_id = exc.response.headers.get("x-fb-trace-id") or "-"
        logger.warning(
            "Meta CAPI {} rejected event_id={} payment_id={} popup_id={} status={} meta_trace_id={}",
            event_name,
            event.event_id,
            event.payment_id,
            event.popup_id,
            exc.response.status_code,
            trace_id,
        )
    except httpx.RequestError:
        logger.exception(
            "Meta CAPI {} request failed event_id={} payment_id={} popup_id={}",
            event_name,
            event.event_id,
            event.payment_id,
            event.popup_id,
        )


def _normalize_pixel_id(pixel_id: Any) -> str | None:
    if pixel_id is None:
        return None
    value = str(pixel_id).strip()
    if not value:
        return None
    if not _META_PIXEL_ID_RE.fullmatch(value):
        logger.warning("Skipping Meta CAPI Purchase: invalid meta_pixel_id")
        return None
    return value


def _tenant_snapshot(tenant: Any) -> SimpleNamespace:
    return SimpleNamespace(
        meta_tracking_enabled=getattr(tenant, "meta_tracking_enabled", False),
        meta_pixel_id=getattr(tenant, "meta_pixel_id", None),
        meta_capi_access_token_encrypted=getattr(
            tenant, "meta_capi_access_token_encrypted", None
        ),
    )


def _payment_snapshot(payment: Any) -> SimpleNamespace:
    buyer_email = _safe_getattr(payment, "buyer_email")
    buyer_name = _safe_getattr(payment, "buyer_name")
    human = _buyer_human(payment)
    return SimpleNamespace(
        id=getattr(payment, "id", ""),
        amount=getattr(payment, "amount", Decimal("0")),
        amount_charged=getattr(payment, "amount_charged", None),
        currency=getattr(payment, "currency", None),
        buyer_email=buyer_email,
        buyer_name=buyer_name,
        buyer_snapshot=getattr(payment, "buyer_snapshot", None),
        meta_fbc=getattr(payment, "meta_fbc", None),
        meta_fbp=getattr(payment, "meta_fbp", None),
        meta_client_ip=getattr(payment, "meta_client_ip", None),
        meta_client_user_agent=getattr(payment, "meta_client_user_agent", None),
        buyer_human_id=getattr(human, "id", None) if human is not None else None,
        buyer_first_name=getattr(human, "first_name", None)
        if human is not None
        else None,
        buyer_last_name=getattr(human, "last_name", None)
        if human is not None
        else None,
        application=None,
        products_snapshot=[
            _payment_product_snapshot(item)
            for item in (getattr(payment, "products_snapshot", None) or [])
        ],
        popup=None,
    )


def _payment_product_snapshot(item: Any) -> SimpleNamespace:
    return SimpleNamespace(
        product_id=getattr(item, "product_id", ""),
        quantity=getattr(item, "quantity", 1),
        effective_unit_price=getattr(item, "effective_unit_price", None),
        product_price=getattr(item, "product_price", Decimal("0")),
        product_name=getattr(item, "product_name", "") or "",
        attendee=None,
    )


def _popup_snapshot(popup: Any) -> SimpleNamespace:
    return SimpleNamespace(
        id=getattr(popup, "id", ""),
        slug=getattr(popup, "slug", "") or "",
        name=getattr(popup, "name", "") or "",
        currency=getattr(popup, "currency", "USD"),
    )


def _safe_getattr(obj: Any, attr: str) -> Any:
    try:
        return getattr(obj, attr, None)
    except Exception:
        return None


def _safe_object_id(obj: Any) -> str:
    try:
        return str(getattr(obj, "id", ""))
    except Exception:
        return ""


def _purchase_event_id(payment: Any) -> str:
    return f"EVT_PURCHASE_{getattr(payment, 'id', '')}"


def _initiate_checkout_event_id(payment: Any) -> str:
    return f"EVT_INITIATE_CHECKOUT_{getattr(payment, 'id', '')}"


def _custom_data(
    payment: Any,
    popup: Any,
    *,
    include_order_id: bool,
) -> dict[str, Any]:
    contents = _contents(payment)
    value = getattr(payment, "amount_charged", None) or getattr(
        payment, "amount", Decimal("0")
    )
    custom_data = {
        "currency": getattr(payment, "currency", None)
        or getattr(popup, "currency", "USD"),
        "value": float(value or Decimal("0")),
        "content_ids": [item["id"] for item in contents],
        "contents": contents,
        "num_items": sum(item["quantity"] for item in contents),
        "popup_id": str(getattr(popup, "id", "")),
        "popup_slug": getattr(popup, "slug", "") or "",
        "popup_name": getattr(popup, "name", "") or "",
    }
    if include_order_id:
        custom_data["order_id"] = str(getattr(payment, "id", ""))
    return custom_data


def _contents(payment: Any) -> list[dict[str, Any]]:
    aggregated: dict[str, dict[str, Any]] = {}
    for item in getattr(payment, "products_snapshot", None) or []:
        product_id = str(getattr(item, "product_id", ""))
        if not product_id:
            continue
        quantity = int(getattr(item, "quantity", 1) or 1)
        unit_price = getattr(item, "effective_unit_price", None) or getattr(
            item, "product_price", Decimal("0")
        )
        if product_id not in aggregated:
            aggregated[product_id] = {
                "id": product_id,
                "quantity": 0,
                "item_price": float(unit_price or Decimal("0")),
                "title": getattr(item, "product_name", "") or "",
            }
        aggregated[product_id]["quantity"] += quantity
    return list(aggregated.values())


def _user_data(payment: Any) -> dict[str, Any]:
    email = _first_non_empty(
        getattr(payment, "buyer_email", None),
        _buyer_snapshot_value(payment, "email"),
    )
    first_name, last_name = _buyer_names(payment)

    user_data: dict[str, Any] = {}
    if email:
        user_data["em"] = [_hash_for_meta(email)]
    if first_name:
        user_data["fn"] = [_hash_for_meta(first_name)]
    if last_name:
        user_data["ln"] = [_hash_for_meta(last_name)]
    human_id = _buyer_human_id(payment)
    if human_id:
        user_data["external_id"] = [_hash_for_meta(str(human_id))]
    fbc = getattr(payment, "meta_fbc", None)
    if fbc:
        user_data["fbc"] = str(fbc)
    fbp = getattr(payment, "meta_fbp", None)
    if fbp:
        user_data["fbp"] = str(fbp)
    client_ip = getattr(payment, "meta_client_ip", None)
    if client_ip:
        user_data["client_ip_address"] = str(client_ip)
    client_user_agent = getattr(payment, "meta_client_user_agent", None)
    if client_user_agent:
        user_data["client_user_agent"] = str(client_user_agent)
    return user_data


def _buyer_names(payment: Any) -> tuple[str | None, str | None]:
    first_name = getattr(payment, "buyer_first_name", None)
    last_name = getattr(payment, "buyer_last_name", None)
    if first_name or last_name:
        return first_name, last_name

    human = _buyer_human(payment)
    first_name = getattr(human, "first_name", None) if human is not None else None
    last_name = getattr(human, "last_name", None) if human is not None else None
    if first_name or last_name:
        return first_name, last_name

    buyer_name = getattr(payment, "buyer_name", None) or _buyer_snapshot_value(
        payment, "name"
    )
    if not buyer_name:
        return None, None
    parts = str(buyer_name).strip().split(maxsplit=1)
    return parts[0] if parts else None, parts[1] if len(parts) > 1 else None


def _buyer_human_id(payment: Any) -> Any | None:
    buyer_human_id = getattr(payment, "buyer_human_id", None)
    if buyer_human_id:
        return buyer_human_id

    human = _buyer_human(payment)
    return getattr(human, "id", None) if human is not None else None


def _buyer_human(payment: Any) -> Any | None:
    application = getattr(payment, "application", None)
    if application is not None and getattr(application, "human", None) is not None:
        return application.human
    for item in getattr(payment, "products_snapshot", None) or []:
        attendee = getattr(item, "attendee", None)
        if attendee is not None and getattr(attendee, "human", None) is not None:
            return attendee.human
    return None


def _buyer_snapshot_value(payment: Any, key: str) -> str | None:
    snapshot = getattr(payment, "buyer_snapshot", None)
    if not isinstance(snapshot, dict):
        return None
    value = snapshot.get(key)
    return str(value) if value else None


def _first_non_empty(*values: Any) -> str | None:
    for value in values:
        if value:
            return str(value)
    return None


def _hash_for_meta(value: str) -> str:
    normalized = value.strip().lower()
    return hashlib.sha256(normalized.encode()).hexdigest()
