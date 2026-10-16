"""Shared directory field configuration defaults and resolution."""

from typing import Any

DEFAULT_DIRECTORY_FIELDS: list[dict[str, Any]] = [
    {"id": "first_name", "label": "First name", "source": "human", "key": "first_name"},
    {"id": "last_name", "label": "Last name", "source": "human", "key": "last_name"},
    {"id": "email", "label": "Email", "source": "human", "key": "email"},
    {"id": "telegram", "label": "Telegram", "source": "human", "key": "telegram"},
]


def directory_fields_for_popup(popup: Any) -> list[dict[str, Any]]:
    configured = getattr(popup, "directory_fields", None) or []
    return configured if configured else DEFAULT_DIRECTORY_FIELDS
