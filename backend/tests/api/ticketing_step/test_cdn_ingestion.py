"""Integration tests for CDN image ingestion in ticketing-step create/update paths.

Slice 2 coverage (all template shapes + watermark + idempotency + fail-open):
  - image-gallery template: images[] external URL → CDN URL
  - rich-text template: <img src> → CDN URL
  - rich-text entity-encoded src (&amp;) → CDN URL  (regression guard)
  - ticket-select template: sections[].image_url → CDN URL
  - watermark (top-level field): external URL → CDN URL
  - idempotency: CDN URL in input → unchanged; fetch_image not called
  - fail-open: IngestionError → original URL kept; step still saves (201)
  - PATCH update wiring: same ingestion runs on changed template_config / watermark

Network layer is always faked: fetch_image and get_storage_service are patched so
no real HTTP requests are made. Pattern matches unit tests in tests/services/.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.api.popup.models import Popups

# CDN base used by the fake storage
CDN_BASE = "https://cdn.test.example.com"
# External URLs that should be ingested
EXTERNAL_A = "https://external.example.com/img-a.jpg"
EXTERNAL_B = "https://other.example.com/img-b.png"
# A URL already hosted on CDN (must match CDN_BASE host for idempotency check)
CDN_EXISTING = f"{CDN_BASE}/preexisting/image.jpg"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _mock_storage() -> MagicMock:
    """Return a minimal storage mock: upload_bytes is a no-op, get_public_url returns CDN URL."""
    s = MagicMock()
    s.get_public_url.side_effect = lambda key: f"{CDN_BASE}/{key}"
    return s


def _step_body(popup_id: uuid.UUID, **extra) -> dict:
    return {
        "popup_id": str(popup_id),
        "step_type": "tickets",
        "title": f"cdn-test-{uuid.uuid4().hex[:6]}",
        **extra,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Create (POST) — verify ingestion runs before persist
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionCreate:
    """POST /ticketing-steps — CDN ingestion must rewrite external URLs before commit."""

    def test_gallery_images_replaced_with_cdn_url(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """image-gallery template: images[] external URLs → CDN URLs in persisted step."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="image-gallery",
                    template_config={"images": [EXTERNAL_A, EXTERNAL_B]},
                ),
            )
        assert resp.status_code == 201, resp.text
        images = resp.json()["template_config"]["images"]
        assert len(images) == 2
        assert images[0].startswith(CDN_BASE + "/"), images[0]
        assert images[1].startswith(CDN_BASE + "/"), images[1]
        assert "external.example.com" not in images[0]
        assert "other.example.com" not in images[1]
        # fetch_image called once per external URL
        assert fetch_mock.call_count == 2

    def test_rich_text_img_src_replaced_with_cdn_url(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """rich-text template: <img src> in html → CDN URL; other markup untouched."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        html_in = f'<p>Hello</p><img src="{EXTERNAL_A}"><span>world</span>'
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="rich-text",
                    template_config={"html": html_in},
                ),
            )
        assert resp.status_code == 201, resp.text
        stored_html = resp.json()["template_config"]["html"]
        assert "external.example.com" not in stored_html
        assert CDN_BASE in stored_html
        # Non-image markup preserved byte-for-byte
        assert "<p>Hello</p>" in stored_html
        assert "<span>world</span>" in stored_html

    def test_rich_text_entity_encoded_src_replaced(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """rich-text: &amp; entity-encoded query string in src is correctly rewritten.

        Regression guard: html.parser decodes entities → decoded URL is fetched → raw
        attribute form (&amp;) is replaced in the original string (design WARNING 3).
        """
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        html_in = '<img src="https://external.example.com/i?a=1&amp;b=2">'
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="rich-text",
                    template_config={"html": html_in},
                ),
            )
        assert resp.status_code == 201, resp.text
        stored_html = resp.json()["template_config"]["html"]
        # The entity-encoded src must be gone; CDN URL must be present
        assert "external.example.com" not in stored_html
        assert CDN_BASE in stored_html

    def test_ticket_select_section_image_url_replaced(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """ticket-select template: sections[].image_url → CDN URL."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        section = {
            "key": "general",
            "label": "General",
            "order": 0,
            "product_ids": [],
            "image_url": EXTERNAL_A,
        }
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="ticket-select",
                    template_config={"sections": [section]},
                ),
            )
        assert resp.status_code == 201, resp.text
        stored_sections = resp.json()["template_config"]["sections"]
        assert len(stored_sections) == 1
        stored_image_url = stored_sections[0]["image_url"]
        assert stored_image_url.startswith(CDN_BASE + "/"), stored_image_url
        assert "external.example.com" not in stored_image_url

    def test_watermark_replaced_with_cdn_url(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """watermark top-level field: external URL → CDN URL on create."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    # Use a simple template so template_config ingestion is a no-op
                    template="image-gallery",
                    template_config={"images": []},
                    watermark=EXTERNAL_A,
                ),
            )
        assert resp.status_code == 201, resp.text
        watermark = resp.json()["watermark"]
        assert watermark is not None
        assert watermark.startswith(CDN_BASE + "/"), watermark
        assert "external.example.com" not in watermark

    def test_cdn_url_unchanged_idempotent(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Images already on the CDN host are returned unchanged; fetch_image not called."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        # Patch settings so that CDN_BASE host is recognized as the CDN host set
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
            patch("app.services.image_ingestion.settings") as mock_settings,
        ):
            mock_settings.STORAGE_PUBLIC_URL = CDN_BASE
            mock_settings.STORAGE_ENDPOINT_URL = None
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="image-gallery",
                    template_config={"images": [CDN_EXISTING]},
                ),
            )
        assert resp.status_code == 201, resp.text
        images = resp.json()["template_config"]["images"]
        assert images[0] == CDN_EXISTING, "CDN URL must be unchanged"
        fetch_mock.assert_not_called()

    def test_fail_open_keeps_original_url_on_ingest_error(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """IngestionError during fetch → original URL kept; step saves successfully (fail-open)."""
        from app.services.image_ingestion import IngestionError

        fetch_mock = AsyncMock(side_effect=IngestionError("simulated network error"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/ticketing-steps",
                headers=_auth(admin_token_tenant_a),
                json=_step_body(
                    popup_tenant_a.id,
                    template="image-gallery",
                    template_config={"images": [EXTERNAL_A]},
                ),
            )
        assert resp.status_code == 201, resp.text
        images = resp.json()["template_config"]["images"]
        # Original URL preserved (fail-open)
        assert images[0] == EXTERNAL_A


# ═══════════════════════════════════════════════════════════════════════════════
# Update (PATCH) — verify ingestion runs on changed template_config / watermark
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionUpdate:
    """PATCH /ticketing-steps/{id} — CDN ingestion must rewrite fields before commit."""

    def _create_baseline_step(
        self,
        client: TestClient,
        token: str,
        popup_id: uuid.UUID,
    ) -> str:
        """Create a plain step (no external URLs) to use as a PATCH base.

        No ingestion patches needed: no template_config or watermark are provided,
        so the ingestion hook is skipped entirely on this initial create.
        """
        resp = client.post(
            "/api/v1/ticketing-steps",
            headers=_auth(token),
            json={
                "popup_id": str(popup_id),
                "step_type": "tickets",
                "title": f"cdn-baseline-{uuid.uuid4().hex[:6]}",
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_gallery_images_ingested_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH with image-gallery template_config: images[] external → CDN."""
        step_id = self._create_baseline_step(
            client, admin_token_tenant_a, popup_tenant_a.id
        )
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.patch(
                f"/api/v1/ticketing-steps/{step_id}",
                headers=_auth(admin_token_tenant_a),
                json={
                    "template": "image-gallery",
                    "template_config": {"images": [EXTERNAL_A]},
                },
            )
        assert resp.status_code == 200, resp.text
        images = resp.json()["template_config"]["images"]
        assert len(images) == 1
        assert images[0].startswith(CDN_BASE + "/"), images[0]
        assert "external.example.com" not in images[0]

    def test_watermark_ingested_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH watermark field only: external URL → CDN URL."""
        step_id = self._create_baseline_step(
            client, admin_token_tenant_a, popup_tenant_a.id
        )
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.patch(
                f"/api/v1/ticketing-steps/{step_id}",
                headers=_auth(admin_token_tenant_a),
                json={"watermark": EXTERNAL_A},
            )
        assert resp.status_code == 200, resp.text
        watermark = resp.json()["watermark"]
        assert watermark is not None
        assert watermark.startswith(CDN_BASE + "/"), watermark
        assert "external.example.com" not in watermark
