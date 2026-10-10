"""Shared SSO/OTP lifecycle: short JWTs, rotating refresh tokens, revocation.

Lock the grant (not just a refresh row) to serialize rotation, replay detection
and disconnect. Never return credentials before committing their consumption.
"""

import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import delete
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.third_party_app.models import ThirdPartyApps
from app.api.third_party_auth.models import ThirdPartyGrants, ThirdPartyRefreshTokens
from app.api.third_party_auth.schemas import ThirdPartyTokenPair
from app.core.config import settings
from app.core.security import (
    THIRD_PARTY_TOKEN_SCOPES_MAX,
    TokenPayload,
    create_access_token,
)


def invalid_grant() -> HTTPException:
    # No disclosure of existence, owner, app, expiry or replay state.
    return HTTPException(status_code=401, detail="Invalid third-party grant")


def refresh_hash(raw: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(),
        ("third-party-refresh:" + raw).encode(),
        hashlib.sha256,
    ).hexdigest()


def authorize_grant(db: Session, grant: ThirdPartyGrants) -> ThirdPartyApps:
    now = datetime.now(UTC)
    if grant.revoked_at or grant.expires_at <= now:
        raise invalid_grant()
    app = db.get(ThirdPartyApps, grant.app_id, populate_existing=True)
    human = db.get(Humans, grant.human_id, populate_existing=True)
    tenant = db.get(Tenants, grant.tenant_id, populate_existing=True)
    if (
        not app
        or not app.active
        or app.revoked_at
        or app.tenant_id != grant.tenant_id
        or not human
        or human.tenant_id != grant.tenant_id
        or human.red_flag
        or not tenant
        or tenant.deleted
    ):
        raise invalid_grant()
    if set(app.allowed_token_scopes) - set(THIRD_PARTY_TOKEN_SCOPES_MAX):
        raise invalid_grant()
    if grant.origin == "sso":
        from app.api.popup.home import get_accessible_home
        from app.api.third_party_sso.service import require_enabled_app

        popup = db.get(Popups, grant.popup_id, populate_existing=True)
        if not popup or popup.tenant_id != grant.tenant_id:
            raise invalid_grant()
        try:
            get_accessible_home(db, popup.slug, grant.tenant_id, grant.human_id)
            require_enabled_app(db, popup, grant.app_id)
        except HTTPException as exc:
            raise invalid_grant() from exc
        if app.sso_redirect_uri != grant.redirect_uri:
            raise invalid_grant()
    elif grant.origin != "otp":
        raise invalid_grant()
    return app


def _mint_pair(db: Session, grant: ThirdPartyGrants) -> ThirdPartyTokenPair:
    now = datetime.now(UTC)
    if grant.expires_at <= now:
        raise invalid_grant()
    access_lifetime = min(
        timedelta(minutes=settings.THIRD_PARTY_ACCESS_TOKEN_EXPIRE_MINUTES),
        grant.expires_at - now,
    )
    refresh_expiry = min(
        now + timedelta(days=settings.THIRD_PARTY_REFRESH_TOKEN_IDLE_DAYS),
        grant.expires_at,
    )
    raw = "eos_rt_" + secrets.token_urlsafe(32)
    db.add(
        ThirdPartyRefreshTokens(
            token_hash=refresh_hash(raw),
            grant_id=grant.id,
            expires_at=refresh_expiry,
        )
    )
    token = create_access_token(
        subject=grant.human_id,
        token_type="human",
        expires_delta=access_lifetime,
        scopes=grant.scopes,
        issued_via="third_party",
        issued_by_app_id=grant.app_id,
        third_party_grant_id=grant.id,
    )
    return ThirdPartyTokenPair(
        access_token=token,
        expires_in=int(access_lifetime.total_seconds()),
        refresh_token=raw,
        refresh_expires_in=int((refresh_expiry - now).total_seconds()),
        grant_id=grant.id,
        grant_expires_at=grant.expires_at,
    )


def issue_pair(
    db: Session,
    app: ThirdPartyApps,
    human: Humans,
    scopes: list[str],
    *,
    origin: Literal["sso", "otp"],
    popup_id: uuid.UUID | None = None,
    redirect_uri: str | None = None,
) -> ThirdPartyTokenPair:
    """Stage a grant and pair; caller must commit before returning credentials.

    SSO commits with code consumption. OTP uses the existing verifier, which
    has already consumed its code; if grant persistence fails, reauthenticate.
    """
    grant = ThirdPartyGrants(
        tenant_id=app.tenant_id,
        human_id=human.id,
        app_id=app.id,
        popup_id=popup_id,
        origin=origin,
        redirect_uri=redirect_uri,
        scopes=sorted(
            set(scopes)
            & set(app.allowed_token_scopes)
            & set(THIRD_PARTY_TOKEN_SCOPES_MAX)
        ),
        expires_at=datetime.now(UTC)
        + timedelta(days=settings.THIRD_PARTY_GRANT_EXPIRE_DAYS),
    )
    current_app = authorize_grant(db, grant)
    grant.scopes = sorted(set(grant.scopes) & set(current_app.allowed_token_scopes))
    db.add(grant)
    db.flush()  # Parent must exist before inserting its refresh credential.
    app.last_used_at = datetime.now(UTC)
    db.add(app)
    return _mint_pair(db, grant)


def _lock_grant_for_token(
    db: Session,
    app: ThirdPartyApps,
    raw: str,
) -> tuple[ThirdPartyGrants, ThirdPartyRefreshTokens]:
    # App-scoped lookup FIRST: a different app cannot revoke a victim's family.
    grant_id = db.exec(
        select(ThirdPartyGrants.id)
        .join(
            ThirdPartyRefreshTokens,
            ThirdPartyRefreshTokens.grant_id == ThirdPartyGrants.id,
        )
        .where(
            ThirdPartyRefreshTokens.token_hash == refresh_hash(raw),
            ThirdPartyGrants.app_id == app.id,
            ThirdPartyGrants.tenant_id == app.tenant_id,
        )
    ).first()
    if grant_id is None:
        raise invalid_grant()
    grant = db.exec(
        select(ThirdPartyGrants)
        .where(ThirdPartyGrants.id == grant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()
    token = db.get(ThirdPartyRefreshTokens, refresh_hash(raw), populate_existing=True)
    if not grant or not token or token.grant_id != grant.id:
        raise invalid_grant()
    return grant, token


def rotate_pair(db: Session, app: ThirdPartyApps, raw: str) -> ThirdPartyTokenPair:
    grant, token = _lock_grant_for_token(db, app, raw)
    now = datetime.now(UTC)
    if grant.revoked_at or grant.expires_at <= now:
        raise invalid_grant()
    if token.consumed_at:
        grant.revoked_at = now
        db.add(grant)
        db.commit()  # Persist replay revocation even though the request fails.
        logger.warning("Third-party refresh replay: app={} grant={}", app.id, grant.id)
        raise invalid_grant()
    if token.expires_at <= now:
        raise invalid_grant()
    current_app = authorize_grant(db, grant)
    # Permanently narrow the original consent. Later app additions cannot
    # recover scopes dropped by an earlier refresh; require new authentication.
    grant.scopes = sorted(set(grant.scopes) & set(current_app.allowed_token_scopes))
    token.consumed_at = now
    current_app.last_used_at = now
    db.add(grant)
    db.add(token)
    db.add(current_app)
    pair = _mint_pair(db, grant)
    db.commit()
    return pair


def revoke_by_token(db: Session, app: ThirdPartyApps, raw: str) -> None:
    # Idempotent and non-disclosing, including unknown and other-app tokens.
    try:
        grant, _ = _lock_grant_for_token(db, app, raw)
    except HTTPException:
        return
    revoke_grant(db, grant)


def revoke_grant(db: Session, grant: ThirdPartyGrants) -> None:
    if grant.revoked_at is None:
        grant.revoked_at = datetime.now(UTC)
        db.add(grant)
    db.commit()


def purge_expired_grants(db: Session, *, batch_size: int = 1000) -> int:
    """Delete one bounded batch, retaining replay history until absolute expiry.

    Keep an extra day for operational investigation. Tokens cascade with their
    grant; never delete consumed ancestors of a still-live family.
    """
    cutoff = datetime.now(UTC) - timedelta(days=1)
    ids = db.exec(
        select(ThirdPartyGrants.id)
        .where(ThirdPartyGrants.expires_at < cutoff)
        .order_by(ThirdPartyGrants.expires_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    ).all()
    if ids:
        db.exec(delete(ThirdPartyGrants).where(ThirdPartyGrants.id.in_(ids)))
    db.commit()
    return len(ids)


def validate_access_grant(db: Session, payload: TokenPayload) -> TokenPayload:
    """Online revocation check for new JWTs; legacy tokens keep their own expiry."""
    grant = db.get(ThirdPartyGrants, payload.third_party_grant_id)
    if (
        not grant
        or payload.issued_via != "third_party"
        or payload.token_type != "human"
        or payload.sub != str(grant.human_id)
        or payload.issued_by_app_id != grant.app_id
    ):
        raise invalid_grant()
    app = authorize_grant(db, grant)
    # Even still-live access JWTs cannot exercise permissions removed by the
    # app or by a refresh of this family. Never add scopes to an old token.
    payload.scopes = sorted(
        set(payload.scopes) & set(grant.scopes) & set(app.allowed_token_scopes)
    )
    return payload
