import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.api.third_party_app.schemas import ThirdPartyAppCreate, ThirdPartyAppUpdate
from app.api.third_party_app.sso_urls import validate_sso_url
from app.core.config import Environment


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "/callback",
        "http://partner.example/start",
        "http://localhost.evil.example/start",
        "https://user:pass@partner.example/start",
        "https://partner.example/start?q=1",
        "https://partner.example/start?",
        "https://partner.example/start#",
        "https://partner.example/start#fragment",
        "https://partner.example/\\evil",
        "https://partner.example/\nstart",
        "https://partner.example:bad/start",
    ],
)
def test_reject_unsafe_sso_urls(url):
    with pytest.raises(ValidationError):
        ThirdPartyAppUpdate(sso_start_url=url)


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:4000/auth/start",
        "http://127.0.0.1:4000/auth/start",
        "http://demo.localhost:4000/auth/start",
    ],
)
def test_local_http_dev_only(url):
    with patch(
        "app.api.third_party_app.sso_urls.settings.ENVIRONMENT", Environment.DEV
    ):
        assert validate_sso_url(url) == url
    with patch(
        "app.api.third_party_app.sso_urls.settings.ENVIRONMENT", Environment.PRODUCTION
    ):
        with pytest.raises(ValueError):
            validate_sso_url(url)


def test_https_registration():
    body = ThirdPartyAppCreate(
        name="Partner",
        sso_start_url="https://partner.example/auth/start",
        sso_redirect_uri="https://partner.example/auth/callback",
    )
    assert body.sso_redirect_uri == "https://partner.example/auth/callback"


def test_api_configure_and_clear(client, admin_token_tenant_a):
    headers = {"Authorization": f"Bearer {admin_token_tenant_a}"}
    base = "/api/v1/third-party-apps"
    response = client.post(
        base,
        headers=headers,
        json={
            "name": f"sso-config-{uuid.uuid4().hex}",
            "sso_start_url": "https://partner.example/start",
        },
    )
    assert response.status_code == 422
    response = client.post(
        base,
        headers=headers,
        json={
            "name": f"sso-config-{uuid.uuid4().hex}",
            "sso_start_url": "https://partner.example/start",
            "sso_redirect_uri": "https://partner.example/callback",
        },
    )
    assert response.status_code == 201, response.text
    app_id = response.json()["id"]
    response = client.patch(
        f"{base}/{app_id}", headers=headers, json={"sso_start_url": None}
    )
    assert response.status_code == 422
    response = client.patch(
        f"{base}/{app_id}",
        headers=headers,
        json={"sso_start_url": None, "sso_redirect_uri": None},
    )
    assert response.status_code == 200
    assert response.json()["sso_start_url"] is None
    assert response.json()["sso_redirect_uri"] is None
    assert "raw_key" not in response.json()
    client.delete(f"{base}/{app_id}", headers=headers)
