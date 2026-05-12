"""Open-ticketing email verification.

Sends a 6-digit code to a buyer's email and lets the portal confirm it
before payment. State lives in Redis with a short TTL; no DB tables added.

The flow is intentionally narrow:
* `start_email_verification(email)` writes a fresh code for ``email`` and
  emails it. Idempotent — re-sending overwrites the previous code.
* `confirm_email_verification(email, code)` compares + invalidates the
  code on success. Returns ``True`` if the code matches and hasn't
  expired; ``False`` otherwise.

This module is tenant-agnostic: the keys include the popup slug so two
popups asking for the same email don't share state. The portal trusts
``confirm_email_verification`` returning ``True`` as proof of email
ownership, and gates the purchase endpoint accordingly (validated by
keeping a per-(slug, email) marker key for a short window after confirm).
"""

from __future__ import annotations

import secrets

from app.core.redis import get_redis

CODE_TTL_SECONDS = 10 * 60  # 10 minutes
CONFIRMED_TTL_SECONDS = 30 * 60  # mark email "verified" for 30 minutes
CODE_KEY_TMPL = "checkout:emailverify:code:{slug}:{email}"
CONFIRMED_KEY_TMPL = "checkout:emailverify:ok:{slug}:{email}"


def _generate_code() -> str:
    # 6-digit zero-padded, cryptographically random.
    return f"{secrets.randbelow(1_000_000):06d}"


def _norm(email: str) -> str:
    return email.strip().lower()


def issue_code(slug: str, email: str) -> str:
    """Generate + store a fresh verification code, return it.

    Caller is responsible for emailing the code; this module just owns
    the storage so retries / confirms can find it.
    """
    code = _generate_code()
    r = get_redis()
    if r is None:
        # Without Redis we still return the code but it can't be confirmed
        # later — refuse to issue so the caller fails loudly instead.
        raise RuntimeError("Redis unavailable for email verification")
    r.setex(
        CODE_KEY_TMPL.format(slug=slug, email=_norm(email)),
        CODE_TTL_SECONDS,
        code,
    )
    return code


def confirm_code(slug: str, email: str, code: str) -> bool:
    """Return True if `code` matches the pending one and is still live."""
    r = get_redis()
    if r is None:
        return False
    norm = _norm(email)
    key = CODE_KEY_TMPL.format(slug=slug, email=norm)
    stored = r.get(key)
    if stored is None:
        return False
    if isinstance(stored, bytes):
        stored = stored.decode("utf-8")
    if stored != code.strip():
        return False
    # Code matched — burn it and stash a "verified" marker so the
    # purchase endpoint can trust this email for a short window.
    r.delete(key)
    r.setex(
        CONFIRMED_KEY_TMPL.format(slug=slug, email=norm),
        CONFIRMED_TTL_SECONDS,
        "1",
    )
    return True


def is_email_verified(slug: str, email: str) -> bool:
    """Whether `email` has a live verified marker for `slug`."""
    r = get_redis()
    if r is None:
        return False
    key = CONFIRMED_KEY_TMPL.format(slug=slug, email=_norm(email))
    return r.exists(key) == 1
