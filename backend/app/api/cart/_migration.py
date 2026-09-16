from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.api.cart.schemas import CartLine, CartState, CartUnassigned
from app.api.payment.schemas import PaymentRecipientRequest

_line_adapter = TypeAdapter(CartLine)
_recipient_adapter = TypeAdapter(PaymentRecipientRequest)


def _entries(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [entry for entry in value if isinstance(entry, dict)]


def _optional_positive_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 1 else None


def _optional_nonnegative_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _string_map(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    return {
        key: item
        for key, item in value.items()
        if isinstance(key, str) and isinstance(item, str)
    }


def _answers(value: Any) -> dict[str, Any]:
    """Guest-form answers, whose values are whatever the field type produced.

    Unlike ``_string_map`` this keeps numbers, booleans and lists: a number
    field answers with a number and a multiselect with a list, and coercing
    them to strings here would change what the purchase validates.
    """
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _guests(value: Any) -> list[dict[str, Any]]:
    """Accommodation guests, in the ``{name, answers}`` shape the line uses.

    Legacy carts hold bare names, and carts saved after the guest form landed
    hold the richer entries, so both are read. Empty slots are kept: a party
    half typed in is what a saved cart is for, and the checkout counts on the
    slots being there.
    """
    if not isinstance(value, list):
        return []
    guests: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, str):
            guests.append({"name": item, "answers": {}})
        elif isinstance(item, dict):
            name = item.get("name")
            guests.append(
                {
                    "name": name if isinstance(name, str) else "",
                    "answers": _answers(item.get("answers")),
                }
            )
    return guests


def _identity(entry: dict[str, Any], recipient_keys: set[str]) -> dict[str, Any]:
    recipient_key = entry.get("recipient_key")
    if isinstance(recipient_key, str) and recipient_key in recipient_keys:
        return {"assignment": {"kind": "recipient", "recipient_key": recipient_key}}

    attendee_id = entry.get("attendee_id")
    if not isinstance(attendee_id, str) or not attendee_id:
        return {"assignment": {"kind": "unassigned"}}
    if attendee_id.startswith("recipient:"):
        recipient_key = attendee_id.removeprefix("recipient:")
        if recipient_key in recipient_keys:
            return {"assignment": {"kind": "recipient", "recipient_key": recipient_key}}
    return {"assignment": {"kind": "attendee", "attendee_id": attendee_id}}


def _quantity(value: Any) -> int:
    if isinstance(value, bool):
        return 1
    try:
        quantity = int(value)
    except (TypeError, ValueError):
        return 1
    return max(quantity, 1)


def _parse_line(value: Any) -> CartLine | None:
    try:
        return _line_adapter.validate_python(value)
    except ValidationError:
        return None


def _recipients(raw: dict[str, Any]) -> list[PaymentRecipientRequest]:
    recipients: list[PaymentRecipientRequest] = []
    seen: set[str] = set()
    for entry in _entries(raw.get("recipients")):
        try:
            recipient = _recipient_adapter.validate_python(entry)
        except ValidationError:
            continue
        if recipient.recipient_key not in seen:
            recipients.append(recipient)
            seen.add(recipient.recipient_key)
    return recipients


def _top_level(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "promo_code": raw.get("promo_code")
        if isinstance(raw.get("promo_code"), str)
        else None,
        "insurance": raw.get("insurance")
        if isinstance(raw.get("insurance"), bool)
        else False,
        "current_step": raw.get("current_step")
        if isinstance(raw.get("current_step"), str)
        else None,
    }


def _state(raw: dict[str, Any], values: list[Any]) -> CartState:
    recipients = _recipients(raw)
    recipient_keys = {recipient.recipient_key for recipient in recipients}
    lines: list[CartLine] = []
    for value in values:
        line = _parse_line(value)
        if line is None:
            continue
        assignment = line.assignment
        if (
            assignment.kind == "recipient"
            and assignment.recipient_key not in recipient_keys
        ):
            line = line.model_copy(
                update={"assignment": CartUnassigned(kind="unassigned")}
            )
        lines.append(line)
    return CartState(lines=lines, recipients=recipients, **_top_level(raw))


def _legacy_lines(raw: dict[str, Any]) -> list[dict[str, Any]]:
    recipients = _recipients(raw)
    recipient_keys = {recipient.recipient_key for recipient in recipients}
    lines: list[dict[str, Any]] = []

    pass_product_ids: set[Any] = set()
    for entry in _entries(raw.get("passes")):
        pass_product_ids.add(entry.get("product_id"))
        lines.append(
            {
                "kind": "product",
                "product_id": entry.get("product_id"),
                "quantity": _quantity(entry.get("quantity", 1)),
                "step_type": "tickets",
                **_identity(entry, recipient_keys),
            }
        )

    housing = raw.get("housing")
    if isinstance(housing, dict):
        lines.append(
            {
                "kind": "date_range",
                "product_id": housing.get("product_id"),
                "check_in": housing.get("check_in"),
                "check_out": housing.get("check_out"),
                "quantity": _quantity(housing.get("quantity", 1)),
                "step_type": "housing",
                **_identity(housing, recipient_keys),
            }
        )

    for entry in _entries(raw.get("merch")):
        lines.append(
            {
                "kind": "product",
                "product_id": entry.get("product_id"),
                "quantity": _quantity(entry.get("quantity", 1)),
                "step_type": "merch",
                **_identity(entry, recipient_keys),
            }
        )

    patron = raw.get("patron")
    if isinstance(patron, dict):
        lines.append(
            {
                "kind": "custom_amount",
                "product_id": patron.get("product_id"),
                "amount": patron.get("amount"),
                "is_custom_amount": patron.get("is_custom_amount")
                if isinstance(patron.get("is_custom_amount"), bool)
                else False,
                "step_type": "patron",
                **_identity(patron, recipient_keys),
            }
        )

    for entry in _entries(raw.get("meal_plans")):
        lines.append(
            {
                "kind": "meal_plan",
                "product_id": entry.get("product_id"),
                "daily_choices": _string_map(entry.get("daily_choices")),
                "dietary_restriction": entry.get("dietary_restriction")
                if isinstance(entry.get("dietary_restriction"), str)
                else None,
                "special_request": entry.get("special_request")
                if isinstance(entry.get("special_request"), str)
                else None,
                "step_type": "meal_plan",
                **_identity(entry, recipient_keys),
            }
        )

    for entry in _entries(raw.get("accommodations")):
        lines.append(
            {
                "kind": "accommodation",
                "accommodation_id": entry.get("accommodation_id"),
                "check_in": entry.get("check_in"),
                "check_out": entry.get("check_out"),
                "guest_count": _optional_positive_int(entry.get("guest_count")),
                "guests": _guests(entry.get("guests")),
                "booker_answers": _answers(entry.get("booker_answers")),
                "step_type": "housing",
                **_identity(entry, recipient_keys),
            }
        )

    for entry in _entries(raw.get("dynamic_items")):
        if entry.get("product_id") in pass_product_ids:
            continue
        lines.append(
            {
                "kind": "product",
                "product_id": entry.get("product_id"),
                "quantity": _quantity(entry.get("quantity", 1)),
                "price": _optional_nonnegative_float(entry.get("price")),
                "step_type": entry.get("step_type")
                if isinstance(entry.get("step_type"), str)
                else None,
                **_identity(entry, recipient_keys),
            }
        )
    return lines


def migrate_cart_state(raw: Any) -> tuple[CartState, bool]:
    """Normalize persisted JSONB without exposing a legacy public model."""
    if not isinstance(raw, dict):
        return CartState(), True
    if "lines" in raw:
        values = raw.get("lines") if isinstance(raw.get("lines"), list) else []
        return _state(raw, values), False
    return _state(raw, _legacy_lines(raw)), True
