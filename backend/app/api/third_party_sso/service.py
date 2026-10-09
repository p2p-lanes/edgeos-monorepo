import base64
import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from fastapi import HTTPException
from loguru import logger
from sqlalchemy import delete
from sqlmodel import Session, select

from app.api.human.models import Humans
from app.api.popup.home import get_accessible_home
from app.api.popup.models import Popups
from app.api.third_party_app.models import ThirdPartyApps
from app.api.third_party_app.sso_urls import validate_sso_pair
from app.api.third_party_sso.models import (
    PopupThirdPartyApps,
    ThirdPartyAuthorizationCodes,
)
from app.api.third_party_sso.schemas import (
    AuthorizationCodeRequest,
    SSOExchangePublic,
    SSOExchangeRequest,
)
from app.core.config import settings
from app.core.security import THIRD_PARTY_TOKEN_SCOPES_MAX, create_access_token


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("ascii")).hexdigest()


def pkce_challenge(verifier: str) -> str:
    return (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )


def require_enabled_app(
    db: Session, popup: Popups, app_id: uuid.UUID
) -> ThirdPartyApps:
    app = db.get(ThirdPartyApps, app_id, populate_existing=True)
    link = db.get(PopupThirdPartyApps, (popup.id, app_id), populate_existing=True)
    if (
        not app
        or app.tenant_id != popup.tenant_id
        or not app.active
        or app.revoked_at
        or not link
        or link.tenant_id != popup.tenant_id
        or not link.enabled
        or not app.sso_start_url
        or not app.sso_redirect_uri
    ):
        raise HTTPException(status_code=404, detail="App not available")
    try:
        validate_sso_pair(app.sso_start_url, app.sso_redirect_uri)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="App not available") from exc
    if set(app.allowed_token_scopes) - set(THIRD_PARTY_TOKEN_SCOPES_MAX):
        raise HTTPException(status_code=500, detail="Invalid app scope configuration")
    return app


def issue_code(
    db: Session,
    popup: Popups,
    app: ThirdPartyApps,
    human_id: uuid.UUID,
    body: AuthorizationCodeRequest,
) -> str:
    now = datetime.now(UTC)
    # Retain a day of transaction metadata, not a permanently growing code table.
    db.exec(
        delete(ThirdPartyAuthorizationCodes).where(
            ThirdPartyAuthorizationCodes.expires_at < now - timedelta(days=1)
        )
    )
    code = secrets.token_urlsafe(32)
    db.add(
        ThirdPartyAuthorizationCodes(
            code_hash=code_hash(code),
            tenant_id=popup.tenant_id,
            human_id=human_id,
            popup_id=popup.id,
            app_id=app.id,
            redirect_uri=app.sso_redirect_uri,
            code_challenge=body.code_challenge,
            scopes=list(app.allowed_token_scopes),
            expires_at=now + timedelta(seconds=settings.SSO_CODE_EXPIRE_SECONDS),
        )
    )
    db.commit()
    logger.info(
        "SSO authorization issued: app={} popup={} human={}", app.id, popup.id, human_id
    )
    return f"{app.sso_redirect_uri}?{urlencode({'code': code, 'state': body.state})}"


def exchange_code(
    db: Session, app: ThirdPartyApps, body: SSOExchangeRequest
) -> SSOExchangePublic:
    # PostgreSQL serializes concurrent canjes of the same code. Validate before
    # consuming so an invalid request cannot burn someone else's authorization.
    row = db.exec(
        select(ThirdPartyAuthorizationCodes)
        .where(
            ThirdPartyAuthorizationCodes.code_hash == code_hash(body.code),
            ThirdPartyAuthorizationCodes.app_id == app.id,
            ThirdPartyAuthorizationCodes.tenant_id == app.tenant_id,
        )
        .with_for_update()
    ).first()
    now = datetime.now(UTC)
    if (
        not row
        or row.consumed_at
        or row.expires_at <= now
        or row.redirect_uri != body.redirect_uri
        or not secrets.compare_digest(
            row.code_challenge, pkce_challenge(body.code_verifier)
        )
    ):
        raise HTTPException(status_code=400, detail="Invalid authorization code")
    human = db.get(Humans, row.human_id)
    popup = db.get(Popups, row.popup_id)
    if (
        not human
        or human.tenant_id != app.tenant_id
        or not popup
        or popup.tenant_id != app.tenant_id
    ):
        raise HTTPException(status_code=400, detail="Invalid authorization code")
    try:
        get_accessible_home(db, popup.slug, app.tenant_id, human.id)
        current_app = require_enabled_app(db, popup, app.id)
    except HTTPException as exc:
        if exc.status_code == 500:
            raise
        raise HTTPException(
            status_code=400, detail="Invalid authorization code"
        ) from exc
    # A changed callback invalidates outstanding codes; scope reductions apply
    # immediately, but additions must not broaden an earlier authorization.
    if current_app.sso_redirect_uri != row.redirect_uri:
        raise HTTPException(status_code=400, detail="Invalid authorization code")
    scopes = sorted(
        set(row.scopes)
        & set(current_app.allowed_token_scopes)
        & set(THIRD_PARTY_TOKEN_SCOPES_MAX)
    )
    lifetime = timedelta(minutes=settings.SSO_ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        subject=human.id,
        token_type="human",
        expires_delta=lifetime,
        scopes=scopes,
        issued_via="third_party",
        issued_by_app_id=app.id,
    )
    row.consumed_at = now
    app.last_used_at = now
    db.add(row)
    db.add(app)
    db.commit()  # Never return the token before the consumption is committed.
    logger.info("SSO authorization exchanged: app={} human={}", app.id, human.id)
    return SSOExchangePublic(
        access_token=token, expires_in=int(lifetime.total_seconds())
    )
