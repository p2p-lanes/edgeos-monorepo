"""HMAC-signed order payload for the open-checkout thank-you redirect.

When a popup configures a custom open-checkout success URL together with a
signing secret, the buyer is redirected to that URL carrying a compact,
signed snapshot of the order. This lets an external thank-you page render and
track the purchase without trusting the raw query string (anti-spoof).

Verification contract — the external page MUST mirror this to validate:

    data = base64url_nopad(utf8(json(payload, sorted keys, compact)))
    sig  = base64url_nopad(HMAC_SHA256(secret, data))
    url  = success_url + "?data=<data>&sig=<sig>"

To verify: recompute ``sig`` over the received ``data`` string with the shared
secret, compare in constant time, then base64url-decode ``data`` to recover the
JSON payload. The signature covers the exact transmitted ``data`` bytes, so the
verifier never has to reproduce the JSON canonicalization.

The payload snapshot is taken at payment creation, so it reflects the quoted
order (total, items) — not provider-side choices made afterwards such as the
installment count or payment method.
"""

import base64
import hashlib
import hmac
import json
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def hash_email(email: str) -> str:
    """SHA-256 hex of the normalized (trimmed, lowercased) email.

    Keeps the raw address out of redirect URLs and referrer logs while letting
    the thank-you page match the buyer against its own records.
    """
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def encode_payload(payload: Mapping[str, Any]) -> str:
    """Canonical, URL-safe encoding of the order payload (sorted, compact)."""
    raw = json.dumps(
        payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return _b64url_nopad(raw)


def sign_data(data: str, secret: str) -> str:
    """HMAC-SHA256 of the encoded data string, base64url-nopad encoded."""
    digest = hmac.new(
        secret.encode("utf-8"), data.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64url_nopad(digest)


def build_thank_you_payload(
    *,
    order_id: str,
    first_name: str,
    email: str,
    items: list[dict[str, Any]],
    amount_total: str,
    currency: str,
    issued_at: str,
) -> dict[str, Any]:
    """Assemble the order snapshot sent to the thank-you page.

    Field names form the contract with the external page; keep them stable.
    """
    return {
        "order_id": order_id,
        "first_name": first_name,
        "email_hash": hash_email(email),
        "items": items,
        "amount_total": amount_total,
        "currency": currency,
        "issued_at": issued_at,
    }


def _append_query(base_url: str, extra: list[tuple[str, str]]) -> str:
    parts = urlparse(base_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.extend(extra)
    return urlunparse(parts._replace(query=urlencode(query)))


def build_signed_redirect_url(
    base_url: str, payload: Mapping[str, Any], secret: str
) -> str:
    """Append the signed ``data`` and ``sig`` query params to ``base_url``.

    Existing query params on ``base_url`` are preserved. Use for external
    thank-you pages that must verify the payload.
    """
    data = encode_payload(payload)
    sig = sign_data(data, secret)
    return _append_query(base_url, [("data", data), ("sig", sig)])


def build_unsigned_redirect_url(base_url: str, payload: Mapping[str, Any]) -> str:
    """Append only the ``data`` query param (no signature) to ``base_url``.

    Used for the portal's own thank-you page: the data is cosmetic (drives the
    order summary on a confirmation screen we control), so it needs no HMAC.
    Existing query params are preserved.
    """
    return _append_query(base_url, [("data", encode_payload(payload))])
