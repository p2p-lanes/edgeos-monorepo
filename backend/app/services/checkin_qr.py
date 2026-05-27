"""Generate check-in QR codes and host them for embedding in emails.

The QR encodes exactly ``{"code": <check_in_code>}`` — the same payload the
portal renders (``portal/.../passes/components/common/QRcode.tsx``) so the
emailed QR is recognised by the existing scanner flow
(``POST /attendees/check-in/{code}``). Any drift in this payload silently
breaks scanning, so ``build_checkin_qr_payload`` is the single source of truth.

The image is rendered to PNG with segno (pure-Python, no Pillow) and uploaded
to the S3-compatible bucket under a non-guessable, deterministic key so repeated
sends reuse the same object instead of piling up duplicates.
"""

import hashlib
import io
import json
from typing import Any

import segno
from loguru import logger

from app.services.storage import get_storage_service

QR_KEY_PREFIX = "checkin-qr"
QR_CONTENT_TYPE = "image/png"


def build_checkin_qr_payload(check_in_code: str) -> str:
    """Return the exact string encoded in the QR: ``{"code":<code>}``.

    MUST stay byte-for-byte identical to the portal's ``QRcode.tsx`` payload,
    which is ``JSON.stringify({ code })`` — no whitespace. Python's default
    ``json.dumps`` inserts a space after the colon, so compact separators are
    required to match the JS output exactly.
    """
    return json.dumps({"code": check_in_code}, separators=(",", ":"))


def render_checkin_qr_png(check_in_code: str, scale: int = 6, border: int = 2) -> bytes:
    """Render the check-in QR for *check_in_code* as PNG bytes."""
    payload = build_checkin_qr_payload(check_in_code)
    buffer = io.BytesIO()
    # error="h" (high) keeps the code scannable even if partially obscured.
    segno.make(payload, error="h").save(buffer, kind="png", scale=scale, border=border)
    return buffer.getvalue()


def checkin_qr_storage_key(check_in_code: str) -> str:
    """Deterministic, non-guessable storage key for a code's QR image."""
    digest = hashlib.sha256(check_in_code.encode("utf-8")).hexdigest()
    return f"{QR_KEY_PREFIX}/{digest}.png"


def generate_checkin_qr_url(check_in_code: str) -> str | None:
    """Render + host the check-in QR, returning its public URL.

    Idempotent: if the object already exists it is reused rather than
    re-uploaded. Returns ``None`` when storage is not configured so callers can
    degrade gracefully (e.g. send the email without the image).
    """
    storage = get_storage_service()
    if storage is None:
        logger.warning(
            "Storage not configured; cannot host check-in QR for code {}",
            check_in_code,
        )
        return None

    key = checkin_qr_storage_key(check_in_code)
    if not storage.exists(key):
        png = render_checkin_qr_png(check_in_code)
        storage.upload_bytes(key, png, QR_CONTENT_TYPE)
    return storage.get_public_url(key)


def sample_checkin_pass_preview_vars() -> dict[str, Any]:
    """Sample ``checkin_qrs``/``checkin_qr_url`` for the editor preview + test send.

    The check-in pass template loops over runtime-only data, so without seed
    values the preview shows nothing. We inline a data-URI QR (no S3 upload) —
    it renders in the editor's preview iframe and in test emails.
    """
    data_uri = segno.make(
        build_checkin_qr_payload("SAMPLE-CODE"), error="h"
    ).png_data_uri(scale=4, border=2)
    qrs = [
        {
            "attendee_name": "Alex Rivera",
            "product_name": "Full Pass",
            "check_in_code": "SAMPLEAB",
            "qr_url": data_uri,
        },
        {
            "attendee_name": "Sam Lee",
            "product_name": "Full Pass",
            "check_in_code": "SAMPLECD",
            "qr_url": data_uri,
        },
    ]
    return {"checkin_qrs": qrs, "checkin_qr_url": data_uri}
