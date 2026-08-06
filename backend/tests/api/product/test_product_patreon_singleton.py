"""Integration tests for singleton patreon product constraint per popup.

Spec: patron-product Requirement: Single Active Patreon Product Per Popup
"""

import uuid

from fastapi.testclient import TestClient


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _patreon_product_payload(popup_id: uuid.UUID, *, suffix: str) -> dict:
    return {
        "popup_id": str(popup_id),
        "name": f"Patron Supporter {suffix}",
        "price": "0",
        "category": "patreon",
    }


def _create_isolated_popup(db, tenant_id: uuid.UUID) -> uuid.UUID:
    """Insert a fresh popup directly and return its ID."""
    popup_id = uuid.uuid4()
    slug = f"singleton-test-{popup_id.hex[:8]}"
    conn = db.connection()
    conn.exec_driver_sql(
        """
        INSERT INTO popups (id, name, slug, tenant_id, sale_type, checkout_mode,
                            status, currency, default_language, supported_languages,
                            insurance_enabled, allows_scholarship, allows_incentive,
                            requires_application_fee, events_enabled, application_layout)
        VALUES (%s, %s, %s, %s, 'direct', 'pass_system',
                'active', 'USD', 'en', '{en}', false,
                false, false, false, true, 'single_page')
        """,
        (str(popup_id), f"Singleton Test {popup_id.hex[:8]}", slug, str(tenant_id)),
    )
    db.commit()
    return popup_id


def _cleanup_popup(db, popup_id: uuid.UUID) -> None:
    conn = db.connection()
    conn.exec_driver_sql("DELETE FROM products WHERE popup_id = %s", (str(popup_id),))
    conn.exec_driver_sql("DELETE FROM popups WHERE id = %s", (str(popup_id),))
    db.commit()


class TestPatreonProductSingleton:
    """At most one non-deleted patreon product is allowed per popup."""

    def test_first_patreon_product_created_successfully(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db,
        tenant_a,
    ) -> None:
        """POST first patreon product for a popup returns 201."""
        popup_id = _create_isolated_popup(db, tenant_a.id)
        try:
            suffix = uuid.uuid4().hex[:8]
            resp = client.post(
                "/api/v1/products",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patreon_product_payload(popup_id, suffix=suffix),
            )
            assert resp.status_code == 201, resp.text
        finally:
            _cleanup_popup(db, popup_id)

    def test_second_patreon_product_rejected_with_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db,
        tenant_a,
    ) -> None:
        """POST second patreon product for the same popup returns 422."""
        popup_id = _create_isolated_popup(db, tenant_a.id)
        try:
            # Create first — must succeed
            resp1 = client.post(
                "/api/v1/products",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patreon_product_payload(popup_id, suffix="first"),
            )
            assert resp1.status_code == 201, resp1.text

            # Create second — must fail
            resp2 = client.post(
                "/api/v1/products",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patreon_product_payload(popup_id, suffix="second"),
            )
            assert resp2.status_code == 422, resp2.text
            body = resp2.json()
            detail = str(body.get("detail", "")).lower()
            assert "patron" in detail or "patreon" in detail, (
                f"Expected patron-related error message, got: {body}"
            )
        finally:
            _cleanup_popup(db, popup_id)

    def test_different_popup_can_have_own_patreon_product(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db,
        tenant_a,
    ) -> None:
        """Two different popups can each have their own patreon product."""
        popup_a = _create_isolated_popup(db, tenant_a.id)
        popup_b = _create_isolated_popup(db, tenant_a.id)
        try:
            resp_a = client.post(
                "/api/v1/products",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patreon_product_payload(popup_a, suffix="a"),
            )
            assert resp_a.status_code == 201, resp_a.text

            resp_b = client.post(
                "/api/v1/products",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patreon_product_payload(popup_b, suffix="b"),
            )
            assert resp_b.status_code == 201, resp_b.text
        finally:
            _cleanup_popup(db, popup_a)
            _cleanup_popup(db, popup_b)
