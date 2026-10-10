"""Shared third-party login fixtures."""

import uuid
from unittest.mock import patch

import pytest

from app.api.human.models import Humans
from app.api.popup.models import PopupHomePages, Popups
from app.api.popup.schemas import PopupStatus
from app.api.third_party_app import crud
from app.api.third_party_sso.models import PopupThirdPartyApps
from app.core.security import create_access_token


@pytest.fixture
def setup_sso(db, tenant_a):
    tag = uuid.uuid4().hex
    human = Humans(tenant_id=tenant_a.id, email=f"sso-{tag}@example.com")
    popup = Popups(
        tenant_id=tenant_a.id,
        name="SSO home",
        slug=f"sso-{tag}",
        status=PopupStatus.active,
        custom_home_enabled=True,
    )
    db.add(human)
    db.add(popup)
    db.commit()
    db.refresh(human)
    db.refresh(popup)
    app, key = crud.create(
        db,
        tenant_a.id,
        name=f"sso-{tag}",
        allowed_token_scopes=["portal:profile:read", "portal:applications:read"],
        allowed_api_key_scopes=[],
        sso_start_url="https://partner.example/start",
        sso_redirect_uri="https://partner.example/callback",
    )
    db.add(
        PopupHomePages(popup_id=popup.id, tenant_id=tenant_a.id, html="<h1>Home</h1>")
    )
    db.add(PopupThirdPartyApps(popup_id=popup.id, app_id=app.id, tenant_id=tenant_a.id))
    db.commit()
    token = create_access_token(human.id, token_type="human")
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield human, popup, app, key, token
    db.rollback()
    db.delete(popup)
    db.delete(app)
    db.delete(human)
    db.commit()
