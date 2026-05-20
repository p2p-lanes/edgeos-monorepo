"""Domain dual-auth contract tests for Block 9 (admin guard sweep).

Per-domain tests verifying that admin api-keys with matching scopes can call
representative backoffice endpoints, missing scopes return 403, and the JWT
path continues to work unchanged.

RED-phase for Block 9. Tests fail until routers swap CurrentOperator/CurrentUser/
CurrentWriter/CurrentAdmin + TenantSession to AdminOrApiKey_* + AdminOrApiKeySession_*
aliases.

Domains covered: attendees, events, applications, groups, products, coupons,
form_fields, form_sections, payments, tracks, ticketing_steps, translations,
event_participants, event_venues.

REQ-AA-01 ... REQ-AA-06
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.api.tenant.models import Tenants


def _api_key_headers(raw_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_key}"}


def _jwt_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Attendees domain  (attendees:read / attendees:write)
# ---------------------------------------------------------------------------


class TestAttendeesDualAuth:
    """GET /attendees requires attendees:read. PATCH/DELETE require attendees:write."""

    def test_jwt_admin_list_attendees_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """Existing JWT admin path still works after swap."""
        resp = client.get("/api/v1/attendees", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_attendees_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
        tenant_a: Tenants,
    ) -> None:
        """Admin api-key with attendees:read can list attendees."""
        _, raw = admin_api_key_factory(scopes=["attendees:read"])
        resp = client.get("/api/v1/attendees", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_attendees_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """Admin api-key without attendees:read is rejected on GET /attendees."""
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/attendees", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_attendees_read_get_attendee_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """Admin api-key with attendees:read — GET /attendees/{id} returns 404 for nonexistent."""
        _, raw = admin_api_key_factory(scopes=["attendees:read"])
        nonexistent = uuid.uuid4()
        resp = client.get(
            f"/api/v1/attendees/{nonexistent}", headers=_api_key_headers(raw)
        )
        # 404 means it passed auth (got to the handler) — no 403
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Events domain  (events:read / events:write)
# ---------------------------------------------------------------------------


class TestEventsDualAuth:
    """GET /events requires events:read. POST/PATCH/DELETE require events:write."""

    def test_jwt_admin_list_events_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get("/api/v1/events", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_events_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/events", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_events_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["attendees:read"])
        resp = client.get("/api/v1/events", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_events_write_post_returns_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
        tenant_a: Tenants,
        popup_tenant_a,
    ) -> None:
        """Admin api-key with events:write can reach the create handler (422 for bad body)."""
        _, raw = admin_api_key_factory(scopes=["events:write"])
        resp = client.post(
            "/api/v1/events",
            headers=_api_key_headers(raw),
            json={"popup_id": str(popup_tenant_a.id), "title": "Test"},
        )
        # 201, 422 = auth passed. 403 = auth rejected.
        assert resp.status_code != 403, resp.text

    def test_api_key_missing_events_write_post_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
        popup_tenant_a,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.post(
            "/api/v1/events",
            headers=_api_key_headers(raw),
            json={"popup_id": str(popup_tenant_a.id), "title": "Test"},
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Applications domain  (applications:read / applications:write)
# ---------------------------------------------------------------------------


class TestApplicationsDualAuth:
    """GET /applications requires applications:read. POST/PATCH require applications:write."""

    def test_jwt_admin_list_applications_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/applications", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_applications_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["applications:read"])
        resp = client.get("/api/v1/applications", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_applications_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/applications", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_applications_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["applications:read"])
        resp = client.get(
            f"/api/v1/applications/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        # 404 means auth passed
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Groups domain  (groups:read / groups:write)
# ---------------------------------------------------------------------------


class TestGroupsDualAuth:
    """GET /groups requires groups:read. POST/PATCH/DELETE require groups:write."""

    def test_jwt_admin_list_groups_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get("/api/v1/groups", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_groups_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["groups:read"])
        resp = client.get("/api/v1/groups", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_groups_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/groups", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_groups_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["groups:read"])
        resp = client.get(
            f"/api/v1/groups/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Products domain  (products:read / products:write)
# ---------------------------------------------------------------------------


class TestProductsDualAuth:
    """GET /products requires products:read. PATCH/DELETE require products:write."""

    def test_jwt_admin_list_products_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/products", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_products_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["products:read"])
        resp = client.get("/api/v1/products", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_products_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/products", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_products_write_patch_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """products:write key can reach PATCH handler (404 for nonexistent id)."""
        _, raw = admin_api_key_factory(scopes=["products:write"])
        resp = client.patch(
            f"/api/v1/products/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"name": "updated"},
        )
        assert resp.status_code == 404, resp.text

    def test_api_key_missing_products_write_patch_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["products:read"])
        resp = client.patch(
            f"/api/v1/products/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"name": "updated"},
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Coupons domain  (coupons:read / coupons:write)
# ---------------------------------------------------------------------------


class TestCouponsDualAuth:
    """GET /coupons requires coupons:read. POST/PATCH/DELETE require coupons:write."""

    def test_jwt_admin_list_coupons_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get("/api/v1/coupons", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_coupons_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["coupons:read"])
        resp = client.get("/api/v1/coupons", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_coupons_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/coupons", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_coupons_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["coupons:read"])
        resp = client.get(
            f"/api/v1/coupons/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Form fields domain  (forms:read / forms:write)
# ---------------------------------------------------------------------------


class TestFormFieldsDualAuth:
    """GET /form-fields requires forms:read. POST/PATCH/DELETE require forms:write."""

    def test_jwt_admin_list_form_fields_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/form-fields", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_forms_read_list_form_fields_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["forms:read"])
        resp = client.get("/api/v1/form-fields", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_forms_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/form-fields", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_forms_read_list_form_sections_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["forms:read"])
        resp = client.get("/api/v1/form-sections", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_forms_read_form_sections_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/form-sections", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Payments domain  (payments:read only — write is excluded by design)
# ---------------------------------------------------------------------------


class TestPaymentsDualAuth:
    """GET /payments requires payments:read. PATCH /payments is JWT-only (excluded)."""

    def test_jwt_admin_list_payments_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/payments", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_payments_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["payments:read"])
        resp = client.get("/api/v1/payments", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_payments_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/payments", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_payments_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["payments:read"])
        resp = client.get(
            f"/api/v1/payments/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text

    def test_api_key_with_payments_read_cannot_patch_payment(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """PATCH /payments is JWT-only — api-key must not be accepted even with payments:read."""
        _, raw = admin_api_key_factory(scopes=["payments:read"])
        resp = client.patch(
            f"/api/v1/payments/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"status": "approved"},
        )
        # 403 (api-key path rejected) or 401 is acceptable; 404 would mean auth passed which is wrong
        assert resp.status_code in (401, 403), resp.text


# ---------------------------------------------------------------------------
# Tracks domain  (tracks:read / tracks:write)
# ---------------------------------------------------------------------------


class TestTracksDualAuth:
    """GET /tracks requires tracks:read. POST/PATCH/DELETE require tracks:write."""

    def test_jwt_admin_list_tracks_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get("/api/v1/tracks", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_tracks_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["tracks:read"])
        resp = client.get("/api/v1/tracks", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_tracks_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/tracks", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_tracks_write_delete_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["tracks:write"])
        resp = client.delete(
            f"/api/v1/tracks/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Ticketing steps domain  (ticketing_steps:read / ticketing_steps:write)
# ---------------------------------------------------------------------------


class TestTicketingStepsDualAuth:
    """GET /ticketing-steps requires ticketing_steps:read. POST/PATCH/DELETE require write."""

    def test_jwt_admin_list_ticketing_steps_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/ticketing-steps", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_ticketing_steps_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["ticketing_steps:read"])
        resp = client.get("/api/v1/ticketing-steps", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_ticketing_steps_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/ticketing-steps", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_ticketing_steps_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["ticketing_steps:read"])
        resp = client.get(
            f"/api/v1/ticketing-steps/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Translations domain  (translations:read / translations:write)
# ---------------------------------------------------------------------------


class TestTranslationsDualAuth:
    """GET /translations requires translations:read. POST/DELETE require translations:write."""

    def test_jwt_admin_list_translations_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/translations",
            headers=_jwt_headers(admin_token_tenant_a),
            params={"entity_type": "product", "entity_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_translations_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["translations:read"])
        resp = client.get(
            "/api/v1/translations",
            headers=_api_key_headers(raw),
            params={"entity_type": "product", "entity_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_translations_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get(
            "/api/v1/translations",
            headers=_api_key_headers(raw),
            params={"entity_type": "product", "entity_id": str(uuid.uuid4())},
        )
        assert resp.status_code == 403, resp.text

    def test_api_key_translations_write_delete_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["translations:write"])
        resp = client.delete(
            f"/api/v1/translations/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Event participants domain  (rsvp:write for admin, events:read for list)
# ---------------------------------------------------------------------------


class TestEventParticipantsDualAuth:
    """Backoffice GET /event-participants requires events:read.
    POST/PATCH/DELETE require rsvp:write."""

    def test_jwt_admin_list_participants_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/event-participants", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_events_read_list_participants_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/event-participants", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_events_read_list_participants_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["attendees:read"])
        resp = client.get("/api/v1/event-participants", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_rsvp_write_patch_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["rsvp:write"])
        resp = client.patch(
            f"/api/v1/event-participants/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"role": "speaker"},
        )
        assert resp.status_code == 404, resp.text

    def test_api_key_missing_rsvp_write_patch_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.patch(
            f"/api/v1/event-participants/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"role": "speaker"},
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Event venues domain  (events:read for list, venues:write for mutations)
# ---------------------------------------------------------------------------


class TestEventVenuesDualAuth:
    """GET /event-venues requires events:read. POST/PATCH/DELETE require venues:write."""

    def test_jwt_admin_list_venues_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            "/api/v1/event-venues", headers=_jwt_headers(admin_token_tenant_a)
        )
        assert resp.status_code == 200, resp.text

    def test_api_key_events_read_list_venues_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/event-venues", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_events_read_list_venues_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["attendees:read"])
        resp = client.get("/api/v1/event-venues", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_venues_write_delete_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["venues:write"])
        resp = client.delete(
            f"/api/v1/event-venues/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text

    def test_api_key_missing_venues_write_delete_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.delete(
            f"/api/v1/event-venues/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Humans domain  (humans:read / humans:write — admin routes only)
# ---------------------------------------------------------------------------


class TestHumansDualAuth:
    """GET /humans (admin list) requires humans:read. PATCH requires humans:write.
    POST /humans is superadmin-only and stays JWT-only."""

    def test_jwt_admin_list_humans_succeeds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get("/api/v1/humans", headers=_jwt_headers(admin_token_tenant_a))
        assert resp.status_code == 200, resp.text

    def test_api_key_humans_read_list_succeeds(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["humans:read"])
        resp = client.get("/api/v1/humans", headers=_api_key_headers(raw))
        assert resp.status_code == 200, resp.text

    def test_api_key_missing_humans_read_returns_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/humans", headers=_api_key_headers(raw))
        assert resp.status_code == 403, resp.text

    def test_api_key_humans_read_get_by_id_returns_404_not_403(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        _, raw = admin_api_key_factory(scopes=["humans:read"])
        resp = client.get(
            f"/api/v1/humans/{uuid.uuid4()}", headers=_api_key_headers(raw)
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Excluded domains — verify they are still JWT-only
# ---------------------------------------------------------------------------


class TestExcludedDomains:
    """email_templates, users, tenants, popup_reviewers are JWT-only."""

    def test_api_key_cannot_call_users_endpoint(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """Admin api-key must NOT access /users."""
        _, raw = admin_api_key_factory(scopes=["events:read"])
        resp = client.get("/api/v1/users", headers=_api_key_headers(raw))
        # API key path returns 403 (CurrentAdmin/CurrentSuperadmin guard rejects it)
        assert resp.status_code in (401, 403), resp.text

    def test_api_key_cannot_patch_payment(
        self,
        client: TestClient,
        admin_api_key_factory,
    ) -> None:
        """PATCH /payments must never accept an api-key, even with payments:read."""
        _, raw = admin_api_key_factory(scopes=["payments:read"])
        resp = client.patch(
            f"/api/v1/payments/{uuid.uuid4()}",
            headers=_api_key_headers(raw),
            json={"status": "approved"},
        )
        assert resp.status_code in (401, 403), resp.text
