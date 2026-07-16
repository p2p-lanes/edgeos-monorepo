"""Unit tests for the open-checkout thank-you signing contract.

These assert the exact wire format an external thank-you page must mirror to
verify the signed order payload: d = base64url_nopad(json(sorted, compact)),
sig = hex(HMAC_SHA256(secret, d)).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

from app.utils.checkout_signing import (
    build_signed_redirect_url,
    build_thank_you_payload,
    hash_email,
    mask_email,
)

SECRET = "amanita-shared-secret"


def _b64url_decode_nopad(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _verify_like_external_page(url: str, secret: str) -> dict:
    """Reproduce the verifier an external thank-you page would implement."""
    query = parse_qs(urlparse(url).query)
    d = query["d"][0]
    sig = query["sig"][0]
    expected = hmac.new(secret.encode(), d.encode("ascii"), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(sig, expected), "signature mismatch"
    return json.loads(_b64url_decode_nopad(d))


def _payload() -> dict:
    return build_thank_you_payload(
        order_id="order-1",
        first_name="Matias",
        email="Buyer@Test.com",
        items=[{"title": "GA", "qty": 2, "price": 75.0}],
        amount_total=150.0,
        currency="USD",
        issued_at="2026-06-19T12:00:00+00:00",
        exp=1_781_000_000,
    )


def test_hash_email_is_normalized_sha256() -> None:
    assert hash_email("  Buyer@Test.com ") == hash_email("buyer@test.com")
    assert hash_email("buyer@test.com") == hashlib.sha256(b"buyer@test.com").hexdigest()


def test_mask_email_shows_prefix_and_domain() -> None:
    assert mask_email("Buyer@Test.com") == "Bu****@Test.com"
    assert mask_email("a@x.io") == "a****@x.io"
    # Malformed input (no @) is returned trimmed, not exploded.
    assert mask_email(" no-at-sign ") == "no-at-sign"


def test_signed_url_verifies_and_recovers_payload() -> None:
    url = build_signed_redirect_url(
        "https://brand.example.com/thank-you", _payload(), SECRET
    )
    recovered = _verify_like_external_page(url, SECRET)
    assert recovered["order_id"] == "order-1"
    assert recovered["first_name"] == "Matias"
    assert recovered["items"] == [{"title": "GA", "qty": 2, "price": 75.0}]
    assert recovered["amount_total"] == 150.0
    assert recovered["currency"] == "USD"
    # Anti-replay expiry travels inside the signed payload.
    assert recovered["exp"] == 1_781_000_000
    # Raw email is never present; only its hash and masked form travel.
    assert recovered["email_hash"] == hash_email("buyer@test.com")
    assert recovered["email_masked"] == "Bu****@Test.com"
    assert "buyer@test.com" not in url


def test_tampering_with_payload_breaks_signature() -> None:
    url = build_signed_redirect_url(
        "https://brand.example.com/thank-you", _payload(), SECRET
    )
    forged = build_thank_you_payload(
        order_id="order-1",
        first_name="Matias",
        email="buyer@test.com",
        items=[{"title": "GA", "qty": 2, "price": 75.0}],
        amount_total=0.01,  # spoofed total
        currency="USD",
        issued_at="2026-06-19T12:00:00+00:00",
        exp=1_781_000_000,
    )
    forged_data = (
        base64.urlsafe_b64encode(
            json.dumps(forged, separators=(",", ":"), sort_keys=True).encode()
        )
        .rstrip(b"=")
        .decode("ascii")
    )
    # Swap the d param for the forged one, keep the original signature.
    original_sig = parse_qs(urlparse(url).query)["sig"][0]
    tampered = f"https://brand.example.com/thank-you?d={forged_data}&sig={original_sig}"
    try:
        _verify_like_external_page(tampered, SECRET)
    except AssertionError:
        return
    raise AssertionError("forged payload should not verify")


def test_wrong_secret_fails_verification() -> None:
    url = build_signed_redirect_url(
        "https://brand.example.com/thank-you", _payload(), SECRET
    )
    try:
        _verify_like_external_page(url, "not-the-secret")
    except AssertionError:
        return
    raise AssertionError("verification with wrong secret should fail")


def test_existing_query_params_are_preserved() -> None:
    url = build_signed_redirect_url(
        "https://brand.example.com/thank-you?ref=abc", _payload(), SECRET
    )
    query = parse_qs(urlparse(url).query)
    assert query["ref"][0] == "abc"
    assert "d" in query and "sig" in query
