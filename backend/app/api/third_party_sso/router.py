import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlmodel import select

from app.api.human.schemas import AuthenticatedHuman
from app.api.popup.home import get_accessible_home
from app.api.popup.models import Popups
from app.api.third_party_app.crud import validate_third_party_key
from app.api.third_party_app.models import ThirdPartyApps
from app.api.third_party_app.sso_urls import validate_sso_pair
from app.api.third_party_sso import service
from app.api.third_party_sso.models import PopupThirdPartyApps
from app.api.third_party_sso.schemas import (
    AuthorizationCodePublic,
    AuthorizationCodeRequest,
    PopupAppPublic,
    PopupAppUpdate,
    SSOExchangePublic,
    SSOExchangeRequest,
    SSOLaunchPublic,
)
from app.core.dependencies.users import (
    CurrentAdmin,
    CurrentHuman,
    HumanTenantSession,
    SessionDep,
    TenantSession,
    get_admin_jwt_only,
)
from app.core.rate_limit import RateLimit
from app.core.security import TokenPayload, get_token_payload

router = APIRouter(tags=["third-party-sso"])


def portal_human(
    current: CurrentHuman, payload: Annotated[TokenPayload, Depends(get_token_payload)]
) -> AuthenticatedHuman:
    if payload.via_api_key or payload.issued_via != "portal":
        raise HTTPException(status_code=403, detail="A portal session is required")
    return current


PortalHuman = Annotated[AuthenticatedHuman, Depends(portal_human)]


def app_public(popup: Popups, app: ThirdPartyApps, enabled: bool) -> PopupAppPublic:
    return PopupAppPublic(
        app_id=app.id,
        name=app.name,
        enabled=enabled,
        sso_configured=bool(
            app.active
            and not app.revoked_at
            and app.sso_start_url
            and app.sso_redirect_uri
        ),
        launch_path=f"/portal/{popup.slug}/apps/{app.id}/launch",
    )


# These guards must run before TenantSession resolves a tenant. Portal launch
# and credential-based exchange routes keep their separate auth contracts.
@router.get(
    "/popups/{popup_id}/apps",
    response_model=list[PopupAppPublic],
    dependencies=[Depends(get_admin_jwt_only)],
)
def list_popup_apps(
    popup_id: uuid.UUID, db: TenantSession, _admin: CurrentAdmin
) -> list[PopupAppPublic]:
    popup = db.get(Popups, popup_id)
    if not popup:
        raise HTTPException(status_code=404, detail="Popup not found")
    apps = db.exec(
        select(ThirdPartyApps).where(
            ThirdPartyApps.tenant_id == popup.tenant_id,
            ThirdPartyApps.active.is_(True),
            ThirdPartyApps.revoked_at.is_(None),
        )
    ).all()
    links = {
        link.app_id: link.enabled
        for link in db.exec(
            select(PopupThirdPartyApps).where(PopupThirdPartyApps.popup_id == popup.id)
        ).all()
    }
    return [app_public(popup, app, links.get(app.id, False)) for app in apps]


@router.put(
    "/popups/{popup_id}/apps/{app_id}",
    response_model=PopupAppPublic,
    dependencies=[Depends(get_admin_jwt_only)],
)
def set_popup_app(
    popup_id: uuid.UUID,
    app_id: uuid.UUID,
    body: PopupAppUpdate,
    db: TenantSession,
    _admin: CurrentAdmin,
) -> PopupAppPublic:
    popup = db.get(Popups, popup_id)
    app = db.get(ThirdPartyApps, app_id)
    if (
        not popup
        or not app
        or app.tenant_id != popup.tenant_id
        or not app.active
        or app.revoked_at
    ):
        raise HTTPException(status_code=404, detail="App or popup not found")
    if body.enabled:
        try:
            validate_sso_pair(app.sso_start_url, app.sso_redirect_uri)
            if not app.sso_start_url:
                raise ValueError("Configure both SSO URLs before enabling this app")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    link = db.get(PopupThirdPartyApps, (popup_id, app_id))
    if not link:
        link = PopupThirdPartyApps(
            popup_id=popup_id, app_id=app_id, tenant_id=popup.tenant_id
        )
    link.enabled = body.enabled
    db.add(link)
    db.commit()
    return app_public(popup, app, link.enabled)


@router.get(
    "/popups/portal/{slug}/apps/{app_id}/launch", response_model=SSOLaunchPublic
)
def get_sso_launch(
    slug: str,
    app_id: uuid.UUID,
    db: HumanTenantSession,
    human: PortalHuman,
    response: Response,
) -> SSOLaunchPublic:
    response.headers["Cache-Control"] = "no-store"
    popup, _ = get_accessible_home(db, slug, human.tenant_id, human.id)
    app = service.require_enabled_app(db, popup, app_id)
    return SSOLaunchPublic(app_name=app.name, start_url=app.sso_start_url)


@router.post(
    "/popups/portal/{slug}/apps/{app_id}/authorization-codes",
    response_model=AuthorizationCodePublic,
    dependencies=[Depends(RateLimit(30, 60, "rl:sso:issue"))],
)
def create_sso_code(
    slug: str,
    app_id: uuid.UUID,
    body: AuthorizationCodeRequest,
    db: HumanTenantSession,
    human: PortalHuman,
    response: Response,
) -> AuthorizationCodePublic:
    response.headers["Cache-Control"] = "no-store"
    popup, _ = get_accessible_home(db, slug, human.tenant_id, human.id)
    app = service.require_enabled_app(db, popup, app_id)
    return AuthorizationCodePublic(
        redirect_url=service.issue_code(db, popup, app, human.id, body)
    )


@router.post(
    "/auth/human/third-party/sso/exchange",
    response_model=SSOExchangePublic,
    dependencies=[Depends(RateLimit(60, 60, "rl:sso:exchange"))],
)
def exchange_sso_code(
    body: SSOExchangeRequest,
    db: SessionDep,
    response: Response,
    key: Annotated[str, Header(alias="X-Third-Party-Api-Key")],
) -> SSOExchangePublic:
    response.headers["Cache-Control"] = "no-store"
    _tenant, app = validate_third_party_key(db, key)
    return service.exchange_code(db, app, body)
