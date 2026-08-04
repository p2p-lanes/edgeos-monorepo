import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.api.publishable_key.models import PopupPublishableKeys
from app.core.config import settings

KEY_PREFIX = "pk_live_"
RANDOM_PART_LEN = 32
DISPLAY_PREFIX_LEN = len(KEY_PREFIX) + 8


def generate_raw_publishable_key() -> str:
    random_part = secrets.token_urlsafe(24)[:RANDOM_PART_LEN]
    return f"{KEY_PREFIX}{random_part}"


def hash_publishable_key(raw_key: str) -> str:
    return hashlib.sha256(f"{settings.SECRET_KEY}:{raw_key}".encode()).hexdigest()


def looks_like_publishable_key(token: str) -> bool:
    return token.startswith(KEY_PREFIX)


def create_publishable_key(
    session: Session,
    *,
    tenant_id: uuid.UUID,
    name: str,
    allowed_origins: list[str],
    popup_id: uuid.UUID | None = None,
) -> tuple[PopupPublishableKeys, str]:
    raw = generate_raw_publishable_key()
    row = PopupPublishableKeys(
        tenant_id=tenant_id,
        popup_id=popup_id,
        name=name,
        key_prefix=raw[:DISPLAY_PREFIX_LEN],
        key_hash=hash_publishable_key(raw),
        allowed_origins=allowed_origins,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row, raw


def lookup_active_by_raw(session: Session, raw_key: str) -> PopupPublishableKeys | None:
    digest = hash_publishable_key(raw_key)
    row = session.exec(
        select(PopupPublishableKeys).where(PopupPublishableKeys.key_hash == digest)
    ).first()
    if not row or row.revoked_at is not None:
        return None
    return row


def revoke(session: Session, row: PopupPublishableKeys) -> PopupPublishableKeys:
    row.revoked_at = datetime.now(UTC)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
