"""Registered destinations only; HTTP is allowed solely for local development."""

import ipaddress
from urllib.parse import urlsplit

from app.core.config import Environment, settings


def validate_sso_url(value: str | None) -> str | None:
    if value is None:
        return None
    if (
        not value
        or len(value) > 2048
        or any(char in value for char in ("?", "#", "\\"))
        or any(char.isspace() or ord(char) < 32 for char in value)
    ):
        raise ValueError("SSO URL must be a valid absolute URL")
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        _ = url.port
    except ValueError as exc:
        raise ValueError("Invalid SSO URL") from exc
    if (
        not host
        or url.username is not None
        or url.password is not None
        or url.fragment
        or url.query
    ):
        raise ValueError(
            "SSO URL cannot contain credentials, query parameters or fragments"
        )
    local = host == "localhost" or host.endswith(".localhost")
    try:
        local = local or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if url.scheme != "https" and not (
        url.scheme == "http" and local and settings.ENVIRONMENT == Environment.DEV
    ):
        raise ValueError(
            "SSO URLs require HTTPS (HTTP loopback is allowed in dev only)"
        )
    return value


def validate_sso_pair(start: str | None, callback: str | None) -> None:
    if bool(start) != bool(callback):
        raise ValueError("Set both SSO URLs, or clear both to disable SSO")
    validate_sso_url(start)
    validate_sso_url(callback)
