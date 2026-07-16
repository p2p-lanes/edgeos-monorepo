"""Tenant folder resolution for presigned upload URLs.

SUPERADMIN users carry no tenant_id of their own, so their uploads keyed
under superadmin/ regardless of the workspace they were operating on. The
backoffice sends the active workspace in X-Tenant-Id on every request; the
endpoint honors it for superadmins and ignores it for tenant-bound admins.
"""

from unittest.mock import patch

from app.core.config import settings

UPLOAD_URL = "/api/v1/uploads/presigned-url"
PAYLOAD = {"filename": "photo.png", "content_type": "image/png"}


def storage_enabled():
    return patch.multiple(
        settings,
        STORAGE_ACCESS_KEY="test-access-key",
        STORAGE_SECRET_KEY="test-secret-key",
    )


class TestPresignedUrlTenantFolder:
    def test_superadmin_with_tenant_header_keys_under_tenant(
        self, client, superadmin_token, tenant_a
    ):
        with storage_enabled():
            response = client.post(
                UPLOAD_URL,
                json=PAYLOAD,
                headers={
                    "Authorization": f"Bearer {superadmin_token}",
                    "X-Tenant-Id": str(tenant_a.id),
                },
            )

        assert response.status_code == 200
        assert response.json()["key"].startswith(f"{tenant_a.id}/images/")

    def test_superadmin_without_header_falls_back_to_superadmin_folder(
        self, client, superadmin_token
    ):
        with storage_enabled():
            response = client.post(
                UPLOAD_URL,
                json=PAYLOAD,
                headers={"Authorization": f"Bearer {superadmin_token}"},
            )

        assert response.status_code == 200
        assert response.json()["key"].startswith("superadmin/images/")

    def test_admin_keeps_own_tenant_even_with_foreign_header(
        self, client, admin_token_tenant_a, tenant_a, tenant_b
    ):
        with storage_enabled():
            response = client.post(
                UPLOAD_URL,
                json=PAYLOAD,
                headers={
                    "Authorization": f"Bearer {admin_token_tenant_a}",
                    "X-Tenant-Id": str(tenant_b.id),
                },
            )

        assert response.status_code == 200
        assert response.json()["key"].startswith(f"{tenant_a.id}/images/")

    def test_superadmin_with_malformed_header_returns_400(
        self, client, superadmin_token
    ):
        with storage_enabled():
            response = client.post(
                UPLOAD_URL,
                json=PAYLOAD,
                headers={
                    "Authorization": f"Bearer {superadmin_token}",
                    "X-Tenant-Id": "not-a-uuid",
                },
            )

        assert response.status_code == 400

    def test_superadmin_with_unknown_tenant_returns_404(self, client, superadmin_token):
        with storage_enabled():
            response = client.post(
                UPLOAD_URL,
                json=PAYLOAD,
                headers={
                    "Authorization": f"Bearer {superadmin_token}",
                    "X-Tenant-Id": "00000000-0000-0000-0000-000000000000",
                },
            )

        assert response.status_code == 404
