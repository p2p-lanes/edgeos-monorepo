"""Confidential-client refresh/revoke and human-owned disconnect controls."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlmodel import select

from app.api.third_party_app.crud import validate_third_party_key
from app.api.third_party_app.models import ThirdPartyApps
from app.api.third_party_auth import service
from app.api.third_party_auth.models import ThirdPartyGrants
from app.api.third_party_auth.schemas import (
    RefreshTokenRequest,
    ThirdPartyGrantPublic,
    ThirdPartyTokenPair,
)
from app.core.dependencies.users import CurrentHuman, SessionDep
from app.core.rate_limit import RateLimit
from app.core.security import TokenPayload, get_token_payload

router = APIRouter(prefix="/auth/human/third-party", tags=["third-party-auth"])


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post(
    "/refresh",
    response_model=ThirdPartyTokenPair,
    dependencies=[Depends(RateLimit(60, 60, "rl:third-party:refresh"))],
)
def refresh(
    body: RefreshTokenRequest,
    db: SessionDep,
    response: Response,
    key: Annotated[str, Header(alias="X-Third-Party-Api-Key")],
) -> ThirdPartyTokenPair:
    _no_store(response)
    _, app = validate_third_party_key(db, key)
    return service.rotate_pair(db, app, body.refresh_token)


@router.post(
    "/revoke",
    status_code=204,
    dependencies=[Depends(RateLimit(60, 60, "rl:third-party:revoke"))],
)
def revoke(
    body: RefreshTokenRequest,
    db: SessionDep,
    response: Response,
    key: Annotated[str, Header(alias="X-Third-Party-Api-Key")],
) -> None:
    _no_store(response)
    _, app = validate_third_party_key(db, key)
    service.revoke_by_token(db, app, body.refresh_token)


def _require_portal(
    payload: Annotated[TokenPayload, Depends(get_token_payload)],
) -> None:
    if payload.via_api_key or payload.issued_via != "portal":
        raise HTTPException(status_code=403, detail="A portal session is required")


@router.get(
    "/grants",
    response_model=list[ThirdPartyGrantPublic],
    dependencies=[Depends(_require_portal)],
)
def list_grants(
    db: SessionDep, human: CurrentHuman, response: Response
) -> list[ThirdPartyGrantPublic]:
    _no_store(response)
    rows = db.exec(
        select(ThirdPartyGrants, ThirdPartyApps.name)
        .join(ThirdPartyApps, ThirdPartyApps.id == ThirdPartyGrants.app_id)
        .where(
            ThirdPartyGrants.human_id == human.id,
            ThirdPartyGrants.tenant_id == human.tenant_id,
        )
        .order_by(ThirdPartyGrants.created_at.desc())
    ).all()
    return [
        ThirdPartyGrantPublic(**grant.model_dump(), app_name=name)
        for grant, name in rows
    ]


@router.delete(
    "/grants/{grant_id}", status_code=204, dependencies=[Depends(_require_portal)]
)
def disconnect(
    grant_id: uuid.UUID, db: SessionDep, human: CurrentHuman, response: Response
) -> None:
    _no_store(response)
    grant = db.exec(
        select(ThirdPartyGrants)
        .where(
            ThirdPartyGrants.id == grant_id,
            ThirdPartyGrants.human_id == human.id,
            ThirdPartyGrants.tenant_id == human.tenant_id,
        )
        .with_for_update()
    ).first()
    if grant is None:
        raise HTTPException(status_code=404, detail="Grant not found")
    service.revoke_grant(db, grant)
