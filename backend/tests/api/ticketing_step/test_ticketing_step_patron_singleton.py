"""Integration tests for singleton patron-preset ticketing step constraint.

Spec: patron-product Requirement: Single Active Patron Step Per Popup
"""

import uuid

from fastapi.testclient import TestClient


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _patron_step_payload(popup_id: uuid.UUID, *, suffix: str) -> dict:
    return {
        "popup_id": str(popup_id),
        "step_type": "patron",
        "title": f"Patron Step {suffix}",
        "template": "patron-preset",
        "template_config": {
            "presets": [2500, 5000, 7500],
            "allow_custom": True,
            "minimum": 1000,
        },
        "is_enabled": True,
        "order": 3,
    }


def _create_isolated_popup(db, tenant_id: uuid.UUID) -> uuid.UUID:
    """Insert a fresh popup and return its ID."""
    popup_id = uuid.uuid4()
    slug = f"step-singleton-test-{popup_id.hex[:8]}"
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
        (
            str(popup_id),
            f"Step Singleton Test {popup_id.hex[:8]}",
            slug,
            str(tenant_id),
        ),
    )
    db.commit()
    return popup_id


def _cleanup_popup(db, popup_id: uuid.UUID) -> None:
    conn = db.connection()
    conn.exec_driver_sql(
        "DELETE FROM ticketingsteps WHERE popup_id = %s", (str(popup_id),)
    )
    conn.exec_driver_sql("DELETE FROM popups WHERE id = %s", (str(popup_id),))
    db.commit()


class TestPatronStepSingleton:
    """At most one enabled patron-preset ticketing step is allowed per popup."""

    def test_first_patron_step_created_successfully(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db,
        tenant_a,
    ) -> None:
        """POST first patron-preset step for a popup returns 201."""
        popup_id = _create_isolated_popup(db, tenant_a.id)
        try:
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patron_step_payload(popup_id, suffix="first"),
            )
            assert resp.status_code == 201, resp.text
        finally:
            _cleanup_popup(db, popup_id)

    def test_second_patron_step_rejected_with_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db,
        tenant_a,
    ) -> None:
        """POST second patron-preset step for same popup returns 422."""
        popup_id = _create_isolated_popup(db, tenant_a.id)
        try:
            # Create first — must succeed
            resp1 = client.post(
                "/api/v1/ticketing-steps",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patron_step_payload(popup_id, suffix="first"),
            )
            assert resp1.status_code == 201, resp1.text

            # Create second — must fail
            resp2 = client.post(
                "/api/v1/ticketing-steps",
                headers=_admin_headers(admin_token_tenant_a),
                json=_patron_step_payload(popup_id, suffix="second"),
            )
            assert resp2.status_code == 422, resp2.text
            body = resp2.json()
            detail = str(body.get("detail", "")).lower()
            assert "patron" in detail or "step" in detail, (
                f"Expected patron-step error message, got: {body}"
            )
        finally:
            _cleanup_popup(db, popup_id)
