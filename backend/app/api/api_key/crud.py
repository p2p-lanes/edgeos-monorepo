import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.api.api_key.models import ApiKeys
from app.core.config import settings

# Visible prefix on every issued key — lets us pick out API-key bearers
# from JWTs in the auth dependency without parsing them first.
KEY_PREFIX = "eos_live_"
# Length of the random part (urlsafe-base64). 32 chars ≈ 192 bits of entropy.
RANDOM_PART_LEN = 32
# How much of the key (prefix + leading random chars) we surface in the UI.
DISPLAY_PREFIX_LEN = len(KEY_PREFIX) + 8


def generate_raw_key() -> str:
    """Mint a new opaque API key. Format: ``eos_live_<32 urlsafe chars>``."""
    random_part = secrets.token_urlsafe(24)[:RANDOM_PART_LEN]
    return f"{KEY_PREFIX}{random_part}"


def hash_key(raw_key: str) -> str:
    """Peppered sha256 of the raw token. The pepper (SECRET_KEY) means a
    DB leak alone is insufficient to reverse-engineer keys — the attacker
    also needs the app secret."""
    return hashlib.sha256(
        f"{settings.SECRET_KEY}:{raw_key}".encode()
    ).hexdigest()


def display_prefix(raw_key: str) -> str:
    return raw_key[:DISPLAY_PREFIX_LEN]


def looks_like_api_key(token: str) -> bool:
    return token.startswith(KEY_PREFIX)


def lookup_active_by_raw(session: Session, raw_key: str) -> ApiKeys | None:
    """Resolve a raw token to its DB row if it's valid and not revoked/expired.

    Runs on the global engine (caller's responsibility) — bypasses RLS so the
    auth bootstrap can find the row before tenant scope is established.
    """
    digest = hash_key(raw_key)
    row = session.exec(select(ApiKeys).where(ApiKeys.key_hash == digest)).first()
    if not row:
        return None
    if row.revoked_at is not None:
        return None
    if row.expires_at is not None and row.expires_at < datetime.now(UTC):
        return None
    return row


def list_for_human(session: Session, human_id: uuid.UUID) -> list[ApiKeys]:
    """Active + revoked keys for the given human, newest first.

    Listing the soft-deleted (revoked) ones is intentional — users want to
    see "I revoked this on Tuesday" in the audit trail.
    """
    return list(
        session.exec(
            select(ApiKeys)
            .where(ApiKeys.human_id == human_id)
            .order_by(ApiKeys.created_at.desc())
        ).all()
    )


def get_for_human(
    session: Session, key_id: uuid.UUID, human_id: uuid.UUID
) -> ApiKeys | None:
    return session.exec(
        select(ApiKeys)
        .where(ApiKeys.id == key_id)
        .where(ApiKeys.human_id == human_id)
    ).first()


def create_for_human(
    session: Session,
    *,
    tenant_id: uuid.UUID,
    human_id: uuid.UUID,
    name: str,
    expires_at: datetime | None,
) -> tuple[ApiKeys, str]:
    """Mint and persist a new key. Returns (row, raw_token)."""
    raw = generate_raw_key()
    row = ApiKeys(
        tenant_id=tenant_id,
        human_id=human_id,
        name=name,
        key_hash=hash_key(raw),
        prefix=display_prefix(raw),
        expires_at=expires_at,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, raw


def revoke(session: Session, row: ApiKeys) -> ApiKeys:
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        session.add(row)
        session.commit()
        session.refresh(row)
    return row


# Debounce window for last_used_at — at most one write per minute per key,
# to keep the auth hot-path from generating a row update on every request.
_TOUCH_DEBOUNCE_SECONDS = 60


def touch_last_used(session: Session, row: ApiKeys) -> None:
    """Best-effort update of last_used_at, debounced to once per minute.

    Failures are swallowed: a stats update must never break an otherwise-
    valid request.
    """
    now = datetime.now(UTC)
    if row.last_used_at is not None:
        delta = (now - row.last_used_at).total_seconds()
        if delta < _TOUCH_DEBOUNCE_SECONDS:
            return
    try:
        row.last_used_at = now
        session.add(row)
        session.commit()
    except Exception:
        session.rollback()
