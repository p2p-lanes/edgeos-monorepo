"""HMAC-signed order payload for the open-checkout thank-you redirect.

When a popup configures a custom open-checkout success URL together with a
signing secret, the buyer is redirected to that URL carrying a compact,
signed snapshot of the order. This lets an external thank-you page render and
track the purchase without trusting the raw query string (anti-spoof).

Verification contract — the external page MUST mirror this to validate:

    d   = base64url_nopad(utf8(json(payload, sorted keys, compact)))
    sig = hex(HMAC_SHA256(secret, d))
    url = success_url + "?d=<d>&sig=<sig>"

To verify: recompute ``sig`` over the received ``d`` string with the shared
secret, compare in constant time, then base64url-decode ``d`` to recover the
JSON payload. The signature covers the exact transmitted ``d`` bytes, so the
verifier never has to reproduce the JSON canonicalization.

The payload carries an ``exp`` (epoch seconds) so the page can reject stale
links (anti-replay); it also snapshots the quoted order (total, items) at
payment creation — not provider-side choices made afterwards such as the
installment count or payment method.

The portal's own thank-you page uses a separate, unsigned contract (the ``data``
query param) — see :func:`build_unsigned_redirect_url`.
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


def mask_email(email: str) -> str:
    """Masked email for display, e.g. ``ab****@gmail.com``.

    Shows the first two characters of the local part and its domain; everything
    in between is hidden. Best-effort for malformed input (no ``@`` → returned
    trimmed as-is).
    """
    local, at, domain = email.strip().partition("@")
    if not at:
        return local
    return f"{local[:2]}****@{domain}"


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def encode_payload(payload: Mapping[str, Any]) -> str:
    """Canonical, URL-safe encoding of the order payload (sorted, compact)."""
    raw = json.dumps(
        payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False
    ).encode("utf-8")
    return _b64url_nopad(raw)


def sign_data(data: str, secret: str) -> str:
    """HMAC-SHA256 of the encoded data string, base64url-nopad encoded.

    Used for cart-restore tokens. The thank-you redirect uses
    :func:`sign_data_hex` instead (its external contract expects hex).
    """
    digest = hmac.new(
        secret.encode("utf-8"), data.encode("ascii"), hashlib.sha256
    ).digest()
    return _b64url_nopad(digest)


def sign_data_hex(data: str, secret: str) -> str:
    """HMAC-SHA256 of the encoded data string, hex encoded.

    Matches the external thank-you page contract: sig = hex(HMAC_SHA256(secret, d)).
    """
    return hmac.new(
        secret.encode("utf-8"), data.encode("ascii"), hashlib.sha256
    ).hexdigest()


def build_cart_restore_token(cart_id: str, secret: str) -> str:
    """HMAC for an open-checkout cart restore link.

    Signs the cart id so an anonymous buyer can rebuild their saved cart via
    GET /checkout/{slug}/cart?cid=<cart_id>&sig=<token> without logging in. The
    signature makes the link unguessable, so the cart can never be read by
    enumerating ids or emails.
    """
    return sign_data(cart_id, secret)


def verify_cart_restore_token(cart_id: str, sig: str, secret: str) -> bool:
    """Constant-time check of a cart restore token against the cart id."""
    expected = sign_data(cart_id, secret)
    return hmac.compare_digest(expected, sig)


def build_thank_you_payload(
    *,
    order_id: str,
    first_name: str,
    email: str,
    items: list[dict[str, Any]],
    amount_total: float,
    currency: str,
    issued_at: str,
    exp: int,
) -> dict[str, Any]:
    """Assemble the order snapshot sent to the thank-you page.

    Field names form the contract with the external page; keep them stable.
    ``items`` are ``{title, qty, price}`` and ``amount_total`` is a number (no
    thousands separators). ``exp`` is an epoch-seconds expiry (anti-replay)
    covered by the signature.
    """
    return {
        "order_id": order_id,
        "first_name": first_name,
        "email_hash": hash_email(email),
        "email_masked": mask_email(email),
        "items": items,
        "amount_total": amount_total,
        "currency": currency,
        "issued_at": issued_at,
        "exp": exp,
    }


def append_query_params(base_url: str, extra: list[tuple[str, str]]) -> str:
    """Append query params to ``base_url``, preserving any existing ones.

    Also used to forward the checkout language (``lang``) on the success
    redirect — it travels as a plain query param, outside the signed payload,
    so it never affects HMAC verification.
    """
    parts = urlparse(base_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.extend(extra)
    return urlunparse(parts._replace(query=urlencode(query)))


def build_signed_redirect_url(
    base_url: str, payload: Mapping[str, Any], secret: str
) -> str:
    """Append the signed ``d`` and ``sig`` query params to ``base_url``.

    Existing query params on ``base_url`` are preserved. Use for external
    thank-you pages that must verify the payload.
    """
    d = encode_payload(payload)
    sig = sign_data_hex(d, secret)
    return append_query_params(base_url, [("d", d), ("sig", sig)])


def build_unsigned_redirect_url(base_url: str, payload: Mapping[str, Any]) -> str:
    """Append only the ``data`` query param (no signature) to ``base_url``.

    Used for the portal's own thank-you page: the data is cosmetic (drives the
    order summary on a confirmation screen we control), so it needs no HMAC.
    Existing query params are preserved.
    """
    return append_query_params(base_url, [("data", encode_payload(payload))])
