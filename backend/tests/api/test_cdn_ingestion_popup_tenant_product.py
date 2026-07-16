"""Integration tests for CDN image ingestion in popup, tenant, and product write paths.

Slice 3 coverage (tasks 3.5–3.9):
  - Popup create: image_url, icon_url, favicon_url, express_checkout_background
  - Popup update: external URL → CDN URL; CDN URL → idempotent (no re-upload)
  - Tenant create: image_url ingested post-create (tenant.id required as storage key)
  - Tenant update: logo_url external → CDN URL
  - Product create: image_url (scalar) and images[] (array, mixed CDN+external)
  - Product update: image_url → CDN URL
  - Product batch create: image_url → CDN URL (deprecated endpoint, still wired)

Network layer always faked: fetch_image and get_storage_service are patched so no
real HTTP requests are made. Same stubbing approach as test_cdn_ingestion.py (Slice 2).
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.api.popup.models import Popups
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants

# CDN base used by the fake storage
CDN_BASE = "https://cdn.test.example.com"
# External URLs that must be ingested
EXTERNAL_A = "https://external.example.com/img-a.jpg"
EXTERNAL_B = "https://other.example.com/img-b.png"
# A URL already on the CDN — must be returned unchanged (idempotency)
CDN_EXISTING = f"{CDN_BASE}/preexisting/image.jpg"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _mock_storage() -> MagicMock:
    """Minimal storage stub: upload_bytes no-op, get_public_url returns CDN URL."""
    s = MagicMock()
    s.get_public_url.side_effect = lambda key: f"{CDN_BASE}/{key}"
    return s


# ═══════════════════════════════════════════════════════════════════════════════
# Popup — Create (POST /api/v1/popups)
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionPopupCreate:
    """POST /popups — CDN ingestion must rewrite all 4 image fields before commit."""

    def _popup_payload(self, **extra) -> dict:
        return {
            "name": f"CDN Popup Create {uuid.uuid4().hex[:6]}",
            "sale_type": SaleType.direct.value,
            **extra,
        }

    def test_icon_url_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """icon_url with external URL → CDN URL persisted on popup create."""
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
                "/api/v1/popups",
                headers=_auth(admin_token_tenant_a),
                json=self._popup_payload(icon_url=EXTERNAL_A),
            )
        assert resp.status_code == 201, resp.text
        icon_url = resp.json()["icon_url"]
        assert icon_url is not None
        assert icon_url.startswith(CDN_BASE + "/"), icon_url
        assert "external.example.com" not in icon_url
        fetch_mock.assert_called_once()

    def test_favicon_url_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """favicon_url with external URL → CDN URL persisted on popup create."""
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
                "/api/v1/popups",
                headers=_auth(admin_token_tenant_a),
                json=self._popup_payload(favicon_url=EXTERNAL_A),
            )
        assert resp.status_code == 201, resp.text
        favicon_url = resp.json()["favicon_url"]
        assert favicon_url is not None
        assert favicon_url.startswith(CDN_BASE + "/"), favicon_url
        assert "external.example.com" not in favicon_url

    def test_express_checkout_background_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """express_checkout_background with external URL → CDN URL on popup create."""
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
                "/api/v1/popups",
                headers=_auth(admin_token_tenant_a),
                json=self._popup_payload(express_checkout_background=EXTERNAL_A),
            )
        assert resp.status_code == 201, resp.text
        bg = resp.json()["express_checkout_background"]
        assert bg is not None
        assert bg.startswith(CDN_BASE + "/"), bg
        assert "external.example.com" not in bg

    def test_all_four_image_fields_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """All 4 image fields on popup create are ingested in one call."""
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
                "/api/v1/popups",
                headers=_auth(admin_token_tenant_a),
                json=self._popup_payload(
                    image_url=EXTERNAL_A,
                    icon_url=EXTERNAL_B,
                    favicon_url=EXTERNAL_A,
                    express_checkout_background=EXTERNAL_B,
                ),
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        for field in (
            "image_url",
            "icon_url",
            "favicon_url",
            "express_checkout_background",
        ):
            value = body[field]
            assert value is not None and value.startswith(CDN_BASE + "/"), (
                f"{field}={value!r} not on CDN"
            )
        # Each of the 4 external URLs triggered one fetch
        assert fetch_mock.call_count == 4

    def test_fail_open_keeps_original_url_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """IngestionError on popup create → original URL kept; popup still saves (201)."""
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
                "/api/v1/popups",
                headers=_auth(admin_token_tenant_a),
                json=self._popup_payload(icon_url=EXTERNAL_A),
            )
        assert resp.status_code == 201, resp.text
        # Fail-open: original URL preserved
        assert resp.json()["icon_url"] == EXTERNAL_A


# ═══════════════════════════════════════════════════════════════════════════════
# Popup — Update (PATCH /api/v1/popups/{popup_id})
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionPopupUpdate:
    """PATCH /popups/{id} — CDN ingestion must rewrite image fields before commit."""

    def _create_popup(self, client: TestClient, token: str) -> str:
        """Create a plain popup (no image fields) to use as PATCH base."""
        resp = client.post(
            "/api/v1/popups",
            headers=_auth(token),
            json={
                "name": f"CDN Popup Update Base {uuid.uuid4().hex[:6]}",
                "sale_type": SaleType.direct.value,
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_image_url_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """PATCH popup image_url with external URL → CDN URL persisted."""
        popup_id = self._create_popup(client, admin_token_tenant_a)
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
                f"/api/v1/popups/{popup_id}",
                headers=_auth(admin_token_tenant_a),
                json={"image_url": EXTERNAL_A},
            )
        assert resp.status_code == 200, resp.text
        image_url = resp.json()["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url

    def test_cdn_url_unchanged_on_update_idempotent(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """PATCH popup with CDN image_url → unchanged; fetch_image not called."""
        popup_id = self._create_popup(client, admin_token_tenant_a)
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
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
            resp = client.patch(
                f"/api/v1/popups/{popup_id}",
                headers=_auth(admin_token_tenant_a),
                json={"image_url": CDN_EXISTING},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["image_url"] == CDN_EXISTING
        fetch_mock.assert_not_called()

    def test_favicon_url_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        """PATCH popup favicon_url with external URL → CDN URL."""
        popup_id = self._create_popup(client, admin_token_tenant_a)
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
                f"/api/v1/popups/{popup_id}",
                headers=_auth(admin_token_tenant_a),
                json={"favicon_url": EXTERNAL_B},
            )
        assert resp.status_code == 200, resp.text
        favicon_url = resp.json()["favicon_url"]
        assert favicon_url is not None
        assert favicon_url.startswith(CDN_BASE + "/"), favicon_url
        assert "other.example.com" not in favicon_url


# ═══════════════════════════════════════════════════════════════════════════════
# Tenant — Create (POST /api/v1/tenants, superadmin only)
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionTenantCreate:
    """POST /tenants — CDN ingestion runs after create (tenant.id needed as storage key)."""

    def test_image_url_replaced_on_create(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """Create tenant with external image_url → CDN URL in persisted tenant."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        tenant_name = f"CDN Tenant Create {uuid.uuid4().hex[:6]}"
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/tenants",
                headers=_auth(superadmin_token),
                json={
                    "name": tenant_name,
                    "image_url": EXTERNAL_A,
                },
            )
        assert resp.status_code == 201, resp.text
        image_url = resp.json()["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url
        fetch_mock.assert_called_once()

    def test_logo_url_replaced_on_create(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """Create tenant with external logo_url → CDN URL persisted."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
        tenant_name = f"CDN Tenant Logo {uuid.uuid4().hex[:6]}"
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/tenants",
                headers=_auth(superadmin_token),
                json={
                    "name": tenant_name,
                    "logo_url": EXTERNAL_B,
                },
            )
        assert resp.status_code == 201, resp.text
        logo_url = resp.json()["logo_url"]
        assert logo_url is not None
        assert logo_url.startswith(CDN_BASE + "/"), logo_url
        assert "other.example.com" not in logo_url

    def test_fail_open_keeps_original_url_on_create(
        self,
        client: TestClient,
        superadmin_token: str,
    ) -> None:
        """IngestionError on tenant create → original URL kept; tenant still saves (201)."""
        from app.services.image_ingestion import IngestionError

        fetch_mock = AsyncMock(side_effect=IngestionError("simulated error"))
        mock_storage = _mock_storage()
        tenant_name = f"CDN Tenant Failopen {uuid.uuid4().hex[:6]}"
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/tenants",
                headers=_auth(superadmin_token),
                json={
                    "name": tenant_name,
                    "image_url": EXTERNAL_A,
                },
            )
        assert resp.status_code == 201, resp.text
        # Fail-open: original URL preserved
        assert resp.json()["image_url"] == EXTERNAL_A


# ═══════════════════════════════════════════════════════════════════════════════
# Tenant — Update (PATCH /api/v1/tenants/{tenant_id})
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionTenantUpdate:
    """PATCH /tenants/{id} — CDN ingestion must rewrite image fields before commit."""

    def test_logo_url_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """PATCH tenant logo_url with external URL → CDN URL persisted."""
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
                f"/api/v1/tenants/{tenant_a.id}",
                headers=_auth(admin_token_tenant_a),
                json={"logo_url": EXTERNAL_B},
            )
        assert resp.status_code == 200, resp.text
        logo_url = resp.json()["logo_url"]
        assert logo_url is not None
        assert logo_url.startswith(CDN_BASE + "/"), logo_url
        assert "other.example.com" not in logo_url
        fetch_mock.assert_called_once()

    def test_image_url_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """PATCH tenant image_url with external URL → CDN URL persisted."""
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
                f"/api/v1/tenants/{tenant_a.id}",
                headers=_auth(admin_token_tenant_a),
                json={"image_url": EXTERNAL_A},
            )
        assert resp.status_code == 200, resp.text
        image_url = resp.json()["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url

    def test_cdn_url_unchanged_on_update_idempotent(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
    ) -> None:
        """PATCH tenant icon_url with CDN URL → unchanged; fetch_image not called."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
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
            resp = client.patch(
                f"/api/v1/tenants/{tenant_a.id}",
                headers=_auth(admin_token_tenant_a),
                json={"icon_url": CDN_EXISTING},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["icon_url"] == CDN_EXISTING
        fetch_mock.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════════
# Product — Create (POST /api/v1/products)
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionProductCreate:
    """POST /products — CDN ingestion for image_url and images[] before commit."""

    def _product_payload(self, popup_id: uuid.UUID, **extra) -> dict:
        return {
            "popup_id": str(popup_id),
            "name": f"CDN Product {uuid.uuid4().hex[:6]}",
            "price": "25.00",
            **extra,
        }

    def test_image_url_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Create product with external image_url → CDN URL persisted."""
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
                "/api/v1/products",
                headers=_auth(admin_token_tenant_a),
                json=self._product_payload(popup_tenant_a.id, image_url=EXTERNAL_A),
            )
        assert resp.status_code == 201, resp.text
        image_url = resp.json()["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url
        fetch_mock.assert_called_once()

    def test_images_array_external_replaced_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Create product with external images[] → all CDN URLs persisted."""
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
                "/api/v1/products",
                headers=_auth(admin_token_tenant_a),
                json=self._product_payload(
                    popup_tenant_a.id,
                    images=[EXTERNAL_A, EXTERNAL_B],
                ),
            )
        assert resp.status_code == 201, resp.text
        images = resp.json()["images"]
        assert len(images) == 2
        for img in images:
            assert img.startswith(CDN_BASE + "/"), img
        assert fetch_mock.call_count == 2

    def test_images_array_mixed_cdn_and_external_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Create product with mixed images[]: CDN URL unchanged, external URL replaced."""
        fetch_mock = AsyncMock(return_value=(b"img-bytes", "image/jpeg"))
        mock_storage = _mock_storage()
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
                "/api/v1/products",
                headers=_auth(admin_token_tenant_a),
                json=self._product_payload(
                    popup_tenant_a.id,
                    images=[CDN_EXISTING, EXTERNAL_A],
                ),
            )
        assert resp.status_code == 201, resp.text
        images = resp.json()["images"]
        assert len(images) == 2
        # First image already on CDN — must be unchanged
        assert images[0] == CDN_EXISTING, f"CDN URL mutated: {images[0]}"
        # Second image external — must be replaced
        assert images[1].startswith(CDN_BASE + "/"), images[1]
        assert "external.example.com" not in images[1]
        # Only the external URL triggered a fetch
        fetch_mock.assert_called_once()

    def test_fail_open_keeps_original_on_create(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """IngestionError on product create → original URL kept; product still saves (201)."""
        from app.services.image_ingestion import IngestionError

        fetch_mock = AsyncMock(side_effect=IngestionError("simulated error"))
        mock_storage = _mock_storage()
        with (
            patch("app.services.image_ingestion.fetch_image", fetch_mock),
            patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=mock_storage,
            ),
        ):
            resp = client.post(
                "/api/v1/products",
                headers=_auth(admin_token_tenant_a),
                json=self._product_payload(
                    popup_tenant_a.id,
                    image_url=EXTERNAL_A,
                    images=[EXTERNAL_B],
                ),
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        # Fail-open: original URLs preserved
        assert body["image_url"] == EXTERNAL_A
        assert body["images"] == [EXTERNAL_B]


# ═══════════════════════════════════════════════════════════════════════════════
# Product — Update (PATCH /api/v1/products/{product_id})
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionProductUpdate:
    """PATCH /products/{id} — CDN ingestion for image_url and images[] before commit."""

    def _create_product(
        self,
        client: TestClient,
        token: str,
        popup_id: uuid.UUID,
    ) -> str:
        """Create a plain product (no image fields) as PATCH base."""
        resp = client.post(
            "/api/v1/products",
            headers=_auth(token),
            json={
                "popup_id": str(popup_id),
                "name": f"CDN Product Base {uuid.uuid4().hex[:6]}",
                "price": "10.00",
            },
        )
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_image_url_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH product image_url with external URL → CDN URL persisted."""
        product_id = self._create_product(
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
                f"/api/v1/products/{product_id}",
                headers=_auth(admin_token_tenant_a),
                json={"image_url": EXTERNAL_A},
            )
        assert resp.status_code == 200, resp.text
        image_url = resp.json()["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url
        fetch_mock.assert_called_once()

    def test_images_array_replaced_on_update(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH product images[] with external URLs → CDN URLs persisted."""
        product_id = self._create_product(
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
                f"/api/v1/products/{product_id}",
                headers=_auth(admin_token_tenant_a),
                json={"images": [EXTERNAL_A, EXTERNAL_B]},
            )
        assert resp.status_code == 200, resp.text
        images = resp.json()["images"]
        assert len(images) == 2
        for img in images:
            assert img.startswith(CDN_BASE + "/"), img
        assert fetch_mock.call_count == 2

    def test_cdn_url_unchanged_on_update_idempotent(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """PATCH product image_url with CDN URL → unchanged; fetch_image not called."""
        product_id = self._create_product(
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
            patch("app.services.image_ingestion.settings") as mock_settings,
        ):
            mock_settings.STORAGE_PUBLIC_URL = CDN_BASE
            mock_settings.STORAGE_ENDPOINT_URL = None
            resp = client.patch(
                f"/api/v1/products/{product_id}",
                headers=_auth(admin_token_tenant_a),
                json={"image_url": CDN_EXISTING},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["image_url"] == CDN_EXISTING
        fetch_mock.assert_not_called()


# ═══════════════════════════════════════════════════════════════════════════════
# Product — Batch Create (POST /api/v1/products/batch, superadmin only, deprecated)
# ═══════════════════════════════════════════════════════════════════════════════


class TestCdnIngestionProductBatch:
    """POST /products/batch — CDN ingestion per item before commit (deprecated endpoint)."""

    def test_image_url_replaced_in_batch(
        self,
        client: TestClient,
        superadmin_token: str,
        popup_tenant_a: Popups,
        tenant_a: Tenants,
    ) -> None:
        """Batch create: external image_url in item → CDN URL in result."""
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
                "/api/v1/products/batch",
                headers={
                    **_auth(superadmin_token),
                    "X-Tenant-Id": str(tenant_a.id),
                },
                json={
                    "popup_id": str(popup_tenant_a.id),
                    "products": [
                        {
                            "name": f"Batch CDN Product {uuid.uuid4().hex[:6]}",
                            "price": "15.00",
                            "image_url": EXTERNAL_A,
                        }
                    ],
                },
            )
        assert resp.status_code == 207, resp.text
        results = resp.json()
        assert len(results) == 1
        assert results[0]["success"] is True, results[0].get("err_msg")
        image_url = results[0]["image_url"]
        assert image_url is not None
        assert image_url.startswith(CDN_BASE + "/"), image_url
        assert "external.example.com" not in image_url
        fetch_mock.assert_called_once()

    def test_images_array_replaced_in_batch(
        self,
        client: TestClient,
        superadmin_token: str,
        popup_tenant_a: Popups,
        tenant_a: Tenants,
    ) -> None:
        """Batch create: external images[] in item → CDN URLs in result."""
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
                "/api/v1/products/batch",
                headers={
                    **_auth(superadmin_token),
                    "X-Tenant-Id": str(tenant_a.id),
                },
                json={
                    "popup_id": str(popup_tenant_a.id),
                    "products": [
                        {
                            "name": f"Batch CDN Images {uuid.uuid4().hex[:6]}",
                            "price": "20.00",
                            "images": [EXTERNAL_A, EXTERNAL_B],
                        }
                    ],
                },
            )
        assert resp.status_code == 207, resp.text
        results = resp.json()
        assert len(results) == 1
        assert results[0]["success"] is True, results[0].get("err_msg")
        images = results[0]["images"]
        assert len(images) == 2
        for img in images:
            assert img.startswith(CDN_BASE + "/"), img
        assert fetch_mock.call_count == 2
