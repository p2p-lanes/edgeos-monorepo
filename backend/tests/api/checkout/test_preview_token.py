"""Tests for the backoffice checkout-preview token.

Covers POST /popups/{popup_id}/checkout-preview-token and the
X-Checkout-Preview-Token header on GET /checkout/{slug}/runtime.

The token exists so the backoffice can render a live preview of a checkout that
is still being configured — i.e. a popup that the public runtime endpoint
deliberately refuses to serve.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from app.utils.checkout_preview import (
    CHECKOUT_PREVIEW_TOKEN_HEADER,
    CHECKOUT_PREVIEW_TOKEN_TYPE,
    mint_checkout_preview_token,
)
from tests.api.checkout.test_bootstrap import (
    _make_direct_popup,
    _make_product,
    _make_ticketing_step,
)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _preview_headers(tenant: Tenants, token: str) -> dict[str, str]:
    return {
        "X-Tenant-Id": str(tenant.id),
        CHECKOUT_PREVIEW_TOKEN_HEADER: token,
    }


# ---------------------------------------------------------------------------
# Token issuance
# ---------------------------------------------------------------------------


def test_operator_can_mint_a_preview_token(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.post(
        f"/api/v1/popups/{popup.id}/checkout-preview-token",
        headers={**_auth(operator_token_tenant_a), "X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)


def test_minting_requires_authentication(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    db.commit()

    response = client.post(f"/api/v1/popups/{popup.id}/checkout-preview-token")

    assert response.status_code == 401


def test_minting_an_unknown_popup_returns_404(
    client: TestClient, tenant_a: Tenants, operator_token_tenant_a: str
) -> None:
    response = client.post(
        f"/api/v1/popups/{uuid.uuid4()}/checkout-preview-token",
        headers={**_auth(operator_token_tenant_a), "X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Runtime unlocked by a valid token
# ---------------------------------------------------------------------------


def test_draft_popup_is_403_without_a_token(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 403


def test_draft_popup_is_served_with_a_token(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    _make_product(db, popup, name="Draft GA")
    db.commit()
    token, _ = mint_checkout_preview_token(popup.id)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["popup"]["slug"] == popup.slug
    assert [p["name"] for p in body["products"]] == ["Draft GA"]


def test_application_popup_is_served_with_a_token(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """sale_type=application is the other public gate the preview lifts."""
    popup = _make_direct_popup(db, tenant_a)
    popup.sale_type = SaleType.application.value
    db.add(popup)
    db.commit()
    token, _ = mint_checkout_preview_token(popup.id)

    unauthorized = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    authorized = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert unauthorized.status_code == 403
    assert authorized.status_code == 200, authorized.text


def test_disabled_steps_are_included_only_in_preview(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    _make_ticketing_step(db, popup, title="Enabled", order=0)
    _make_ticketing_step(db, popup, title="Disabled", order=1, is_enabled=False)
    db.commit()
    token, _ = mint_checkout_preview_token(popup.id)

    public = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )
    preview = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert [s["title"] for s in public.json()["ticketing_steps"]] == ["Enabled"]
    assert [s["title"] for s in preview.json()["ticketing_steps"]] == [
        "Enabled",
        "Disabled",
    ]


# ---------------------------------------------------------------------------
# Tokens that must not unlock anything
# ---------------------------------------------------------------------------


def test_token_for_another_popup_does_not_unlock_this_one(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    draft = _make_direct_popup(db, tenant_a, status="draft")
    other = _make_direct_popup(db, tenant_a)
    db.commit()
    token, _ = mint_checkout_preview_token(other.id)

    response = client.get(
        f"/api/v1/checkout/{draft.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert response.status_code == 403


def test_token_from_another_tenant_does_not_unlock_a_draft(
    client: TestClient, db: Session, tenant_a: Tenants, tenant_b: Tenants
) -> None:
    draft = _make_direct_popup(db, tenant_a, status="draft")
    foreign = _make_direct_popup(db, tenant_b, status="draft")
    db.commit()
    token, _ = mint_checkout_preview_token(foreign.id)

    response = client.get(
        f"/api/v1/checkout/{draft.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert response.status_code == 403


def test_expired_token_is_rejected(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()
    expired = create_access_token(
        subject=popup.id,
        token_type=CHECKOUT_PREVIEW_TOKEN_TYPE,
        expires_delta=timedelta(seconds=-1),
    )

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, expired),
    )

    assert response.status_code == 401


def test_garbage_token_is_rejected(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, "not-a-jwt"),
    )

    assert response.status_code == 401


def test_a_regular_user_token_does_not_unlock_a_draft(
    client: TestClient,
    db: Session,
    tenant_a: Tenants,
    operator_token_tenant_a: str,
) -> None:
    """Only the dedicated token_type counts — an ordinary session JWT does not."""
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, operator_token_tenant_a),
    )

    assert response.status_code == 403


def test_preview_header_survives_cors_preflight(client: TestClient) -> None:
    """The preview runs in an iframe on the portal's origin, so the runtime call
    is cross-origin. A custom header triggers a preflight; if the API does not
    advertise it, the browser blocks the request before it is ever sent and the
    preview just fails to load."""
    response = client.options(
        "/api/v1/checkout/some-slug/runtime",
        headers={
            "Origin": "https://demo.edgeos.world",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": CHECKOUT_PREVIEW_TOKEN_HEADER,
        },
    )

    assert response.status_code == 200, response.text
    allowed = response.headers["access-control-allow-headers"].lower()
    assert CHECKOUT_PREVIEW_TOKEN_HEADER.lower() in allowed


# ---------------------------------------------------------------------------
# Unit-level checks on the helper
# ---------------------------------------------------------------------------


def test_resolve_returns_none_without_a_token() -> None:
    from app.utils.checkout_preview import resolve_preview_popup_id

    assert resolve_preview_popup_id(None) is None
    assert resolve_preview_popup_id("") is None


def test_resolve_ignores_a_non_preview_token_type() -> None:
    from app.utils.checkout_preview import resolve_preview_popup_id

    token = create_access_token(subject=uuid.uuid4(), token_type="user")

    assert resolve_preview_popup_id(token) is None


def test_minted_token_round_trips_to_its_popup_id() -> None:
    from app.utils.checkout_preview import resolve_preview_popup_id

    popup_id = uuid.uuid4()
    token, expires_at = mint_checkout_preview_token(popup_id)

    assert resolve_preview_popup_id(token) == popup_id
    assert expires_at > datetime.now(UTC)


@pytest.mark.parametrize("status_value", ["draft", "archived", "ended"])
def test_every_non_active_status_is_previewable(
    client: TestClient, db: Session, tenant_a: Tenants, status_value: str
) -> None:
    popup = _make_direct_popup(db, tenant_a, status=status_value)
    db.commit()
    token, _ = mint_checkout_preview_token(popup.id)

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert response.status_code == 200, response.text


def test_unknown_slug_still_404s_with_a_token(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a, status="draft")
    db.commit()
    token, _ = mint_checkout_preview_token(popup.id)

    response = client.get(
        f"/api/v1/checkout/does-not-exist-{uuid.uuid4().hex[:6]}/runtime",
        headers=_preview_headers(tenant_a, token),
    )

    assert response.status_code == 404


def test_preview_does_not_affect_a_normal_public_request(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    """Regression guard: the added header must not change public behaviour."""
    popup: Popups = _make_direct_popup(db, tenant_a)
    _make_product(db, popup, name="Public GA")
    _make_ticketing_step(db, popup, title="Only Enabled")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/runtime",
        headers={"X-Tenant-Id": str(tenant_a.id)},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [p["name"] for p in body["products"]] == ["Public GA"]
    assert [s["title"] for s in body["ticketing_steps"]] == ["Only Enabled"]
